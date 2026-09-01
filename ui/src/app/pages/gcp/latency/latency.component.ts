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

import { RegionModel } from '../../../models'
import { RegionService, SeoService } from '../../../services'
import { SITE_URL } from '../../../shared/constants'
import { CopyButtonComponent } from '../../../shared/copy-button/copy-button.component'
import { ExportCsvButtonComponent } from '../../../shared/export-csv-button/export-csv-button.component'
import { LucideIconComponent } from '../../../shared/icons/lucide-icons.component'
import { buildRegionDetailRouterLink } from '../../../shared/utils'
import { RegionGroupComponent } from '../../shared'
import { CloudflareMetaStore } from './cloudflare-meta.store'
import { ConnectionDetailsComponent } from './connection-details.component'
import {
  LATENCY_TEST_CONFIG,
  LatencyTestStore,
  RegionWithLatencyMetrics
} from './latency-test.store'

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
  private readonly latencyTestStore = inject(LatencyTestStore)
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

  public readonly regionsWithMedian = this.latencyTestStore.regionsWithMedian
  public readonly tableData = this.latencyTestStore.tableData
  public readonly isTestRunning = this.latencyTestStore.isTestRunning

  public readonly hasSelectedRegions = computed(
    () => this.regionService.selectedRegions().length > 0
  )

  public readonly shouldShowLatencySkeleton = computed(() => {
    return this.hasSelectedRegions() && this.isTestRunning() && this.tableData().length === 0
  })

  public readonly tableDataTop3 = this.latencyTestStore.tableDataTop3
  public readonly bestRegion = this.latencyTestStore.bestRegion
  public readonly runnerUpRegions = this.latencyTestStore.runnerUpRegions
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
    if (latency < LATENCY_TEST_CONFIG.LATENCY_FAST) {
      return 'fast'
    }
    if (latency < LATENCY_TEST_CONFIG.LATENCY_ACCEPTABLE) {
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

  constructor() {
    this.registerInitialUrlStateEffect()
    if (this.isBrowser) {
      this.registerSelectedRegionsEffect()
    }
  }

  private registerInitialUrlStateEffect(): void {
    // Region data is available synchronously from the bundle, but we still resolve
    // the `regions` query param inside an effect so the restore runs once the
    // signal is read and stays resilient if the list is ever empty.
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
      this.syncUrlWithSelection(regions)
    })
  }

  ngOnInit(): void {
    this.latencyTestStore.activate()
    this.seoService.applyPageSeo({
      title: 'Google Cloud Latency Test | Measure Cloud Run Region Latency',
      description:
        'Test latency from your location to Google Cloud regions worldwide. Measure the round-trip time to Cloud Run regions and find the closest Google Cloud datacenters.',
      path: '/',
      keywords: [
        'Google Cloud latency test',
        'GCP latency test',
        'GCP ping test',
        'Google Cloud region latency',
        'Cloud Run latency',
        'closest Google Cloud region',
        'GCP speed test',
        'Google Cloud region finder',
        'GCP network latency',
        'lowest latency GCP region'
      ],
      structuredData: this.buildStructuredData()
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
    this.latencyTestStore.deactivate()
    this.cloudflareMetaStore.destroy()
  }

  /**
   * schema.org nodes for the latency page: a FAQPage mirroring the on-page FAQ
   * (so search engines and LLMs can extract the answers) and a BreadcrumbList.
   */
  private buildStructuredData(): Record<string, unknown>[] {
    const faq = [
      {
        q: 'What is latency and what constitutes good latency?',
        a: 'Latency (ping) is the time for data to travel from the source to the destination and back. This test reports the median round-trip time (RTT) to Google Cloud region endpoints, where lower is better. Below 50 ms is ideal for real-time apps like gaming and video calls, 50-100 ms is acceptable for interactive apps like web browsing, and above 100 ms can be fine for non-interactive workloads such as file transfers and backups.'
      },
      {
        q: 'How does the Google Cloud Latency Test work?',
        a: 'Your browser sends lightweight HTTPS requests to a Cloud Run endpoint in each selected Google Cloud region. The median latency is calculated by measuring the time between the request and the response, straight from your current location.'
      },
      {
        q: 'Does the latency test reflect actual application performance?',
        a: 'Partially. It is a network-focused indicator, not a full application benchmark. It is good for comparing relative latency between Google Cloud regions and for region-selection discussions, but it is not a substitute for application-level load or performance testing.'
      },
      {
        q: 'Is my speed test result private?',
        a: 'Yes. GCP Speed Test requires no authentication and collects no personal or corporate identity information. Results are generated entirely in your browser, are visible only to you, and are not published, stored, or retained on our servers.'
      },
      {
        q: 'Why might some Google Cloud regions measure high latency?',
        a: 'Distant regions legitimately measure hundreds of milliseconds and the test always shows the real number rather than hiding "slow" regions. The first request to a cold region also pays a TLS handshake and cold-start cost, so a throwaway warm-up ping is sent before recording timed samples.'
      }
    ]

    return [
      {
        '@type': 'FAQPage',
        mainEntity: faq.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.a
          }
        }))
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'GCP Speed Test',
            item: `${SITE_URL}/`
          }
        ]
      }
    ]
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
}
