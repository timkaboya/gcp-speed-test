import { isPlatformBrowser } from '@angular/common'
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  signal,
  untracked
} from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { Subscription, timer } from 'rxjs'

import { RegionModel } from '../../../models'
import { RegionService, SeoService } from '../../../services'
import { CopyButtonComponent } from '../../../shared/copy-button/copy-button.component'
import { ExportCsvButtonComponent } from '../../../shared/export-csv-button/export-csv-button.component'
import { LucideIconComponent } from '../../../shared/icons/lucide-icons.component'
import { buildRegionDetailRouterLink } from '../../../shared/utils'
import { RegionGroupComponent } from '../../shared'
import { CloudflareMetaStore } from './cloudflare-meta.store'
import { ConnectionDetailsComponent } from './connection-details.component'

// Single source of truth - minimal state
interface RegionPingData {
  regionId: string
  geography: string
  displayName: string
  url: string

  // Only store raw ping history - everything else is computed
  pingHistory: number[]
  lastPingTime: number
}

interface RegionWithLatencyMetrics extends RegionPingData {
  medianLatency: number
  currentLatency: number
}

interface LatencyState {
  regions: Map<string, RegionPingData>
  pingAttemptCount: number
  isTestRunning: boolean
}

@Component({
  selector: 'app-gcp-latency',
  imports: [
    RegionGroupComponent,
    RouterLink,
    LucideIconComponent,
    ConnectionDetailsComponent,
    CopyButtonComponent,
    ExportCsvButtonComponent
  ],
  templateUrl: './latency.component.html',
  styleUrl: './latency.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LatencyComponent implements OnInit, OnDestroy {
  private readonly regionService = inject(RegionService)
  private readonly seoService = inject(SeoService)
  private readonly platformId = inject(PLATFORM_ID)
  private readonly isBrowser = isPlatformBrowser(this.platformId)
  private readonly route = inject(ActivatedRoute)
  private readonly router = inject(Router)
  private readonly regionsParamKey = 'regions'
  private lastUrlStateSignature = ''
  private canUpdateUrl = false
  private hasAppliedInitialUrlState = false
  public readonly shareUrl = signal('')
  protected readonly cloudflareMetaStore = inject(CloudflareMetaStore)
  private hasComponentDestroyed = false

  // Configuration constants
  private static readonly CONFIG = {
    MAX_PING_ATTEMPTS: 180,
    PING_INTERVAL_MS: 2000,
    MAX_PING_HISTORY: 20,
    // Cold Cloud Run + TLS handshake on a distant region can take seconds on the
    // first hit, so we allow a generous timeout instead of an artificial cap.
    PING_TIMEOUT_MS: 5000,
    CONCURRENT_PINGS: 4,
    BATCH_UPDATE_DELAY_MS: 50,
    LATENCY_FAST: 100,
    LATENCY_ACCEPTABLE: 200
  } as const

  // Single state signal - minimal source of truth
  private state = signal<LatencyState>({
    regions: new Map(),
    pingAttemptCount: 0,
    isTestRunning: false
  })

  // Batch update mechanism
  private pendingPingUpdates = new Map<string, number>()
  private batchUpdateTimer?: ReturnType<typeof setTimeout>

  // Tracks regions whose TLS connection has been warmed up so the first timed
  // sample measures steady-state latency rather than handshake cost. A region is
  // only marked warmed once a warm-up ping SUCCEEDS, so cold/distant regions keep
  // getting retried instead of being permanently skipped (issue #197).
  private readonly warmedRegions = new Set<string>()

  // All derived data as computed signals - no manual updates needed
  public regionsWithMedian = computed<RegionWithLatencyMetrics[]>(() => {
    const regions = Array.from(this.state().regions.values())
    return regions.map((region) => ({
      ...region,
      medianLatency: this.calculateMedian(region.pingHistory),
      currentLatency: region.pingHistory[region.pingHistory.length - 1] || 0
    }))
  })

  private regionsWithLatency = computed<RegionWithLatencyMetrics[]>(() => {
    return this.regionsWithMedian().filter((region) => region.medianLatency > 0)
  })

  public tableData = computed<RegionWithLatencyMetrics[]>(() => {
    const regions = this.regionsWithLatency()
    return regions.length ? [...regions].sort((a, b) => a.medianLatency - b.medianLatency) : []
  })

  public readonly isTestRunning = computed(() => this.state().isTestRunning)

  public readonly hasSelectedRegions = computed(
    () => this.regionService.selectedRegions().length > 0
  )

  public readonly shouldShowLatencySkeleton = computed(() => {
    return this.hasSelectedRegions() && this.tableData().length === 0
  })

  public tableDataTop3 = computed<RegionWithLatencyMetrics[]>(() => this.tableData().slice(0, 3))
  public bestRegion = computed<RegionWithLatencyMetrics | null>(() => {
    const top = this.tableDataTop3()
    return top.length ? top[0] : null
  })
  public runnerUpRegions = computed<RegionWithLatencyMetrics[]>(() => {
    const top = this.tableDataTop3()
    return top.length > 1 ? top.slice(1) : []
  })
  protected buildRegionRouterLink = buildRegionDetailRouterLink

  // CSV export data
  readonly csvHeaders = [
    'Geography',
    'Region',
    'Region ID',
    'Median Latency (ms)',
    'Latest Latency (ms)'
  ]
  readonly csvRows = computed<string[][] | null>(() => {
    const data = this.tableData()
    if (data.length === 0) return null
    return data.map((row) => [
      row.geography,
      row.displayName,
      row.regionId,
      row.medianLatency.toString(),
      (row.currentLatency || '-').toString()
    ])
  })

  protected getLatencyBadgeState(
    latency: number | null | undefined
  ): 'fast' | 'moderate' | 'slow' | 'unknown' {
    if (!this.hasValidLatency(latency)) {
      return 'unknown'
    }
    if (latency < LatencyComponent.CONFIG.LATENCY_FAST) {
      return 'fast'
    }
    if (latency < LatencyComponent.CONFIG.LATENCY_ACCEPTABLE) {
      return 'moderate'
    }
    return 'slow'
  }

  private hasValidLatency(latency: number | null | undefined): latency is number {
    return typeof latency === 'number' && latency > 0
  }

  // TrackBy functions for optimal rendering performance
  trackByRegionData(_: number, item: RegionWithLatencyMetrics): string {
    return item.regionId || item.displayName
  }

  private pingSubscription?: Subscription

  constructor() {
    this.registerInitialUrlStateEffect()
    if (this.isBrowser) {
      this.registerSelectedRegionsEffect()
    }
  }

  private registerInitialUrlStateEffect(): void {
    // Region data loads asynchronously via HttpClient, so we defer resolving any
    // `regions` query param until the list is available (browser only).
    effect(() => {
      const regions = this.regionService.regions()
      if (this.hasAppliedInitialUrlState || regions.length === 0) {
        return
      }
      this.hasAppliedInitialUrlState = true
      untracked(() => this.applyInitialUrlState(regions))
    })
  }

  private registerSelectedRegionsEffect(): void {
    effect(() => {
      const regions = this.regionService.selectedRegions()
      const hasSelection = regions.length > 0
      const hasReachedLimit = untracked(() => {
        const currentState = this.state()
        return currentState.pingAttemptCount >= LatencyComponent.CONFIG.MAX_PING_ATTEMPTS
      })

      this.syncUrlWithSelection(regions)

      if (!hasSelection) {
        this.pendingPingUpdates.clear()
        this.warmedRegions.clear()
        this.initializeRegions([], { resetPingState: true })
        this.stopPingTimer()
        return
      }

      if (hasReachedLimit) {
        this.pendingPingUpdates.clear()
        this.warmedRegions.clear()
        this.stopPingTimer()
      }

      this.initializeRegions(regions, { resetPingState: hasReachedLimit })

      if (!this.pingSubscription) {
        this.startPingTimer()
      }
    })
  }

  ngOnInit(): void {
    this.seoService.applyPageSeo({
      title: 'Google Cloud Latency Test | Measure Cloud Run Region Latency',
      description:
        'Test latency from your location to Google Cloud regions worldwide. Measure the round-trip time to Cloud Run regions and find the closest Google Cloud datacenters.',
      path: '/Gcp/Latency'
    })
    if (this.isBrowser) {
      // Defer Cloudflare metadata fetch until the browser is idle so initial render stays unblocked.
      const globalScope = globalThis as typeof globalThis & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      }
      if (typeof globalScope.requestIdleCallback === 'function') {
        globalScope.requestIdleCallback(
          () => {
            if (!this.hasComponentDestroyed) {
              void this.cloudflareMetaStore.load()
            }
          },
          { timeout: 3000 }
        )
      } else {
        setTimeout(() => {
          if (!this.hasComponentDestroyed) {
            void this.cloudflareMetaStore.load()
          }
        }, 0)
      }
    }
  }

  ngOnDestroy(): void {
    this.hasComponentDestroyed = true
    this.stopPingTimer()
    if (this.batchUpdateTimer) {
      clearTimeout(this.batchUpdateTimer)
    }
    this.cloudflareMetaStore.destroy()
  }

  private applyInitialUrlState(allRegions: RegionModel[]): void {
    const lookup = this.buildNormalizedRegionLookup(allRegions)
    const rawRegions = this.route.snapshot.queryParamMap.get(this.regionsParamKey)
    const parsedRegionTokens = this.parseRegionParam(rawRegions)
    const regions = parsedRegionTokens.length
      ? this.resolveRegionsFromIds(parsedRegionTokens, lookup)
      : []
    const hasSelection = regions.length > 0

    if (hasSelection) {
      this.lastUrlStateSignature = this.buildSignature(regions.map((region) => region.regionId))
      this.regionService.updateSelectedRegions(regions)
    }

    this.updateShareUrl(hasSelection)
    this.canUpdateUrl = true
  }

  private parseRegionParam(raw: string | null): string[] {
    if (!raw) return []
    const tokens = new Set<string>()
    const sanitized = raw.replace(/[|;]/g, ',')
    for (const part of sanitized.split(',')) {
      const token = this.normalizeToken(part)
      if (token) {
        tokens.add(token)
      }
    }
    return Array.from(tokens)
  }

  private normalizeToken(value: string | null | undefined): string {
    if (value == null) return ''
    return value
      .toLowerCase()
      .replace(/[\s/_-]+/g, '')
      .replace(/[^a-z0-9]/g, '')
  }

  private resolveRegionsFromIds(
    regionTokens: string[],
    lookup: Map<string, RegionModel>
  ): RegionModel[] {
    if (!regionTokens.length) {
      return []
    }

    const selected: RegionModel[] = []
    const seen = new Set<string>()

    for (const token of regionTokens) {
      const key = this.normalizeToken(token)
      if (!key) continue
      const match = lookup.get(key)
      if (match && !seen.has(match.regionId)) {
        seen.add(match.regionId)
        selected.push(match)
      }
    }

    return selected
  }

  private buildSignature(regionIds: string[], options: { alreadySorted?: boolean } = {}): string {
    const normalizedIds = regionIds.map((id) => this.normalizeToken(id))
    if (!options.alreadySorted) {
      normalizedIds.sort()
    }
    return normalizedIds.join(',')
  }

  private buildNormalizedRegionLookup(regions: RegionModel[]): Map<string, RegionModel> {
    const lookup = new Map<string, RegionModel>()
    for (const region of regions) {
      const key = this.normalizeToken(region.regionId)
      if (key && !lookup.has(key)) {
        lookup.set(key, region)
      }
    }
    return lookup
  }

  private syncUrlWithSelection(regions: RegionModel[]): void {
    if (!this.isBrowser || !this.canUpdateUrl) return

    const regionIds = regions.map((region) => region.regionId)
    const sortedRegionIds = [...regionIds].sort((a, b) => a.localeCompare(b))
    const normalizedRegionSignature = this.buildSignature(sortedRegionIds, { alreadySorted: true })
    if (normalizedRegionSignature === this.lastUrlStateSignature) {
      return
    }

    this.lastUrlStateSignature = normalizedRegionSignature

    const queryParams = { ...this.route.snapshot.queryParams }
    if (sortedRegionIds.length) {
      queryParams[this.regionsParamKey] = sortedRegionIds.join(',')
    } else {
      delete queryParams[this.regionsParamKey]
    }

    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams,
        replaceUrl: true
      })
      .finally(() => this.updateShareUrl(sortedRegionIds.length > 0))
  }

  private updateShareUrl(hasSelection: boolean): void {
    if (!this.isBrowser) return
    if (!hasSelection) {
      this.shareUrl.set('')
      return
    }
    this.shareUrl.set(window.location.href)
  }

  private initializeRegions(
    regions: RegionModel[],
    options: { resetPingState?: boolean } = {}
  ): void {
    const resetPingState = options.resetPingState ?? false
    // Get the current state to preserve existing ping history
    const currentState = untracked(() => this.state())
    const currentRegions = currentState.regions

    const regionMap = new Map(
      regions
        .filter((region) => region.url && region.regionId)
        .map((region) => {
          const key = region.regionId

          // Check if this region already exists and has ping history
          const existingRegion = currentRegions.get(key)

          return [
            key,
            {
              regionId: region.regionId,
              geography: region.geography,
              displayName: region.displayName,
              url: region.url,
              // Preserve existing ping history unless we are kicking off a fresh run
              pingHistory: resetPingState ? [] : existingRegion?.pingHistory || [],
              lastPingTime: resetPingState ? 0 : existingRegion?.lastPingTime || 0
            }
          ]
        })
    )

    const hasRegions = regionMap.size > 0

    this.state.set({
      regions: regionMap,
      // Reset ping attempt count when starting a new run or when no regions are selected
      pingAttemptCount: resetPingState || !hasRegions ? 0 : currentState.pingAttemptCount || 0,
      isTestRunning: hasRegions && !resetPingState ? currentState.isTestRunning : false
    })
  }

  private startPingTimer(): void {
    if (this.pingSubscription) {
      return
    }

    this.state.update((state) => ({ ...state, isTestRunning: true }))

    this.pingSubscription = timer(0, LatencyComponent.CONFIG.PING_INTERVAL_MS).subscribe(() => {
      const currentState = this.state()
      if (currentState.pingAttemptCount >= LatencyComponent.CONFIG.MAX_PING_ATTEMPTS) {
        this.stopPingTimer()
        return
      }

      void this.pingAllRegions()
      this.state.update((state) => ({
        ...state,
        pingAttemptCount: state.pingAttemptCount + 1
      }))
    })
  }

  private stopPingTimer(): void {
    if (!this.pingSubscription) {
      return
    }

    this.pingSubscription.unsubscribe()
    this.pingSubscription = undefined
    this.state.update((state) => ({ ...state, isTestRunning: false }))
  }

  private async pingAllRegions(): Promise<void> {
    const { CONCURRENT_PINGS } = LatencyComponent.CONFIG

    const regions = Array.from(this.state().regions.values())

    // Process in chunks for concurrency control
    for (let i = 0; i < regions.length; i += CONCURRENT_PINGS) {
      const chunk = regions.slice(i, i + CONCURRENT_PINGS)
      await Promise.allSettled(chunk.map((region) => this.pingRegion(region)))
    }
  }

  private async pingRegion(region: RegionPingData): Promise<void> {
    if (!this.isBrowser) return
    if (!region.url || !region.regionId) return

    // Warm up the TLS connection once per region before recording any sample.
    // A cold request pays DNS + TCP + TLS handshake cost (hundreds of ms), which
    // dwarfs the actual round-trip. We only mark the region "warmed" when the
    // warm-up ping actually succeeds, so cold/distant regions keep getting retried
    // rather than being permanently skipped. See issue #197.
    if (!this.warmedRegions.has(region.regionId)) {
      const warmedUp = await this.sendPing(region.url)
      if (!warmedUp) return
      this.warmedRegions.add(region.regionId)
    }

    const startTime = performance.now()
    const succeeded = await this.sendPing(region.url)
    if (!succeeded) return

    const latency = Math.round(performance.now() - startTime)
    this.queuePingUpdate(region.regionId, latency)
  }

  private async sendPing(url: string): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), LatencyComponent.CONFIG.PING_TIMEOUT_MS)

    try {
      // Cloud Run endpoints have no CORS, so a normal `mode: 'cors'` fetch rejects.
      // We use `mode: 'no-cors'` HEAD requests: the response is opaque (status 0,
      // unreadable) but the promise resolving means the round trip completed.
      // Custom headers are forbidden in no-cors, and `cache: 'no-cache'` would
      // trigger a preflight, so we rely on `cache: 'no-store'` plus the `?_=`
      // cache-buster to defeat caching.
      await fetch(`${url}?_=${Date.now()}`, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal
      })
      return true
    } catch {
      // Silent fail: rejection means the region was unreachable within the timeout.
      return false
    } finally {
      clearTimeout(timeoutId)
    }
  }

  private queuePingUpdate(regionId: string, latency: number): void {
    const { BATCH_UPDATE_DELAY_MS } = LatencyComponent.CONFIG

    // No upper-bound latency filter: `sendPing` already aborts unsuccessful
    // requests at PING_TIMEOUT_MS, so any value we get here is a real, completed
    // round-trip. A hard cap silently dropped legitimately distant regions,
    // making them vanish from the results entirely instead of showing their true
    // latency. See issue #197.
    this.pendingPingUpdates.set(regionId, latency)

    // Batch updates to reduce state operations
    if (!this.batchUpdateTimer) {
      this.batchUpdateTimer = setTimeout(() => {
        this.flushPingUpdates()
        this.batchUpdateTimer = undefined
      }, BATCH_UPDATE_DELAY_MS)
    }
  }

  private flushPingUpdates(): void {
    if (this.pendingPingUpdates.size === 0) return

    const updates = new Map(this.pendingPingUpdates)
    this.pendingPingUpdates.clear()

    this.state.update((currentState) => {
      const regions = new Map(currentState.regions)
      const timestamp = Date.now()

      for (const [regionId, latency] of updates) {
        const region = regions.get(regionId)
        if (!region) continue

        // Update ping history (single source of truth)
        const history = [...region.pingHistory, latency]
        if (history.length > LatencyComponent.CONFIG.MAX_PING_HISTORY) {
          history.shift()
        }

        regions.set(regionId, {
          ...region,
          pingHistory: history,
          lastPingTime: timestamp
        })
      }

      return {
        ...currentState,
        regions
      }
    })
  }

  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0
    if (values.length === 1) return values[0]

    const sorted = [...values].sort((a, b) => a - b)

    // Simple outlier removal for small samples
    if (sorted.length <= 5 && sorted.length > 2) {
      sorted.pop() // Remove highest
    }

    // IQR method for larger samples
    if (sorted.length > 5) {
      const q1 = sorted[Math.floor(sorted.length * 0.25)]
      const q3 = sorted[Math.floor(sorted.length * 0.75)]
      const iqr = q3 - q1
      const lowerBound = q1 - 1.5 * iqr
      const upperBound = q3 + 1.5 * iqr

      const filtered = sorted.filter((v) => v >= lowerBound && v <= upperBound)
      if (filtered.length > 0) {
        const mid = Math.floor(filtered.length / 2)
        return filtered.length % 2 === 0
          ? Math.floor((filtered[mid - 1] + filtered[mid]) / 2)
          : filtered[mid]
      }
    }

    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? Math.floor((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
  }
}
