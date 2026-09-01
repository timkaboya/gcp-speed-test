import { isPlatformBrowser } from '@angular/common'
import {
  computed,
  effect,
  inject,
  Injectable,
  OnDestroy,
  PLATFORM_ID,
  signal,
  untracked
} from '@angular/core'

import { RegionModel } from '../../../models'
import { RegionService } from '../../../services'

export const LATENCY_TEST_CONFIG = {
  MAX_HUMAN_ROUNDS: 180,
  PING_INTERVAL_MS: 2000,
  MAX_PING_HISTORY: 20,
  PING_TIMEOUT_MS: 5000,
  REQUEST_SETTLEMENT_GRACE_MS: 250,
  CONCURRENT_PINGS: 4,
  TOOL_NAVIGATION_TIMEOUT_MS: 10_000,
  TOOL_RUN_DEADLINE_MS: 120_000,
  TOOL_RUN_COOLDOWN_MS: 15_000,
  TERMINAL_SNAPSHOT_TTL_MS: 300_000,
  MAX_TOOL_SAMPLES: 5,
  LATENCY_FAST: 100,
  LATENCY_ACCEPTABLE: 200
} as const

export type LatencyRunOwner = 'human' | 'webmcp'
export type LatencyRunStatus =
  'starting' | 'running' | 'completed' | 'partial' | 'cancelled' | 'failed'

export interface RegionPingData {
  regionId: string
  geography: string
  displayName: string
  url: string
  pingHistory: number[]
  lastPingTime: number
  requestAttempts: number
  failedAttempts: number
  nextAttemptAt: number
}

export interface RegionWithLatencyMetrics extends RegionPingData {
  medianLatency: number
  currentLatency: number
}

export interface LatencyRun {
  runId: string
  owner: LatencyRunOwner
  status: LatencyRunStatus
  generation: number
  targetSamples: number | null
  rounds: number
  requestCount: number
  requestBudget: number | null
  startedAt: number | null
  completedAt: number | null
  deadlineAt: number | null
  reason?: string
}

export interface LatencyState {
  regions: Map<string, RegionPingData>
  run: LatencyRun | null
  revision: number
}

interface ToolRunReservation {
  runId: string
  generation: number
  regions: RegionModel[]
  targetSamples: number
  replaceActive: boolean
  previousRunId: string | null
  previousSelectionSignature: string
}

interface PermitWaiter {
  signal: AbortSignal
  resolve: (release: (() => void) | null) => void
  abort: () => void
}

export interface ToolRunStartSuccess {
  ok: true
  runId: string
  generation: number
}

export interface ToolRunStartFailure {
  ok: false
  code: 'BUSY' | 'COOLDOWN' | 'INVALID_INPUT' | 'UNAVAILABLE'
}

export type ToolRunStartResult = ToolRunStartSuccess | ToolRunStartFailure

type PingResult = 'success' | 'network' | 'timeout' | 'aborted' | 'budget'

@Injectable({ providedIn: 'root' })
export class LatencyTestStore implements OnDestroy {
  private readonly regionService = inject(RegionService)
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID))
  private readonly stateSignal = signal<LatencyState>({
    regions: new Map(),
    run: null,
    revision: 0
  })
  private readonly terminalToolStateSignal = signal<LatencyState | null>(null)
  private readonly warmedRegions = new Set<string>()

  private viewActive = false
  private generation = 0
  private runController?: AbortController
  private deadlineTimer?: ReturnType<typeof setTimeout>
  private terminalSnapshotTimer?: ReturnType<typeof setTimeout>
  private pendingToolRun?: ToolRunReservation
  private ignoredSelectionSignature = ''
  private lastToolRunStartedAt = 0
  private activeRequestCount = 0
  private readonly permitQueue: PermitWaiter[] = []
  private readonly viewActivationWaiters = new Set<(active: boolean) => void>()

  readonly state = this.stateSignal.asReadonly()
  readonly run = computed(() => this.stateSignal().run)
  readonly revision = computed(() => this.stateSignal().revision)
  readonly isTestRunning = computed(() => {
    const status = this.stateSignal().run?.status
    return status === 'starting' || status === 'running'
  })
  readonly regionsWithMedian = computed<RegionWithLatencyMetrics[]>(() =>
    Array.from(this.stateSignal().regions.values()).map((region) => ({
      ...region,
      medianLatency: this.calculateMedian(region.pingHistory),
      currentLatency: region.pingHistory.at(-1) ?? 0
    }))
  )
  private readonly regionsWithLatency = computed(() =>
    this.regionsWithMedian().filter((region) => region.medianLatency > 0)
  )
  readonly tableData = computed(() =>
    [...this.regionsWithLatency()].sort((a, b) => a.medianLatency - b.medianLatency)
  )
  readonly tableDataTop3 = computed(() => this.tableData().slice(0, 3))
  readonly bestRegion = computed<RegionWithLatencyMetrics | null>(
    () => this.tableDataTop3()[0] ?? null
  )
  readonly runnerUpRegions = computed(() => this.tableDataTop3().slice(1))
  readonly toolRunSummary = computed(() => {
    const current = this.stateSignal()
    const state =
      current.run?.owner === 'webmcp' && this.isActive(current.run)
        ? current
        : this.terminalToolStateSignal()
    if (!state?.run) {
      return null
    }
    return {
      run: { ...state.run },
      regionCount: state.regions.size
    }
  })

  constructor() {
    effect(() => {
      const selected = this.regionService.selectedRegions()
      untracked(() => this.handleRegionSelection(selected))
    })
  }

  activate(): void {
    if (!this.isBrowser || this.viewActive) {
      return
    }
    this.viewActive = true
    this.resolveViewActivationWaiters(true)
    if (!this.pendingToolRun) {
      this.startOrUpdateHumanRun(this.regionService.selectedRegions())
    }
  }

  deactivate(): void {
    if (!this.viewActive) {
      return
    }
    this.viewActive = false
    this.cancelActiveRun('page_deactivated')
    this.pendingToolRun = undefined
    this.warmedRegions.clear()
    this.stateSignal.set({ regions: new Map(), run: null, revision: 0 })
  }

  ngOnDestroy(): void {
    this.runController?.abort('store_destroyed')
    this.runController = undefined
    this.clearDeadline()
    this.clearTerminalToolState()
    this.resolveViewActivationWaiters(false)
  }

  waitForViewActivation(signal: AbortSignal): Promise<boolean> {
    if (this.viewActive) {
      return Promise.resolve(true)
    }
    if (signal.aborted) {
      return Promise.resolve(false)
    }

    return new Promise((resolve) => {
      let settled = false
      const finish = (active: boolean) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutId)
        signal.removeEventListener('abort', abort)
        this.viewActivationWaiters.delete(finish)
        resolve(active)
      }
      const abort = () => finish(false)

      const timeoutId = setTimeout(
        () => finish(false),
        LATENCY_TEST_CONFIG.TOOL_NAVIGATION_TIMEOUT_MS
      )
      signal.addEventListener('abort', abort, { once: true })
      this.viewActivationWaiters.add(finish)
      if (signal.aborted) {
        finish(false)
      }
    })
  }

  reserveToolRun(
    regions: RegionModel[],
    targetSamples: number,
    replaceActive: boolean
  ): ToolRunStartResult {
    if (!this.isBrowser) {
      return { ok: false, code: 'UNAVAILABLE' }
    }
    if (
      !Number.isInteger(targetSamples) ||
      targetSamples < 1 ||
      targetSamples > LATENCY_TEST_CONFIG.MAX_TOOL_SAMPLES ||
      regions.length === 0
    ) {
      return { ok: false, code: 'INVALID_INPUT' }
    }

    if (this.pendingToolRun) {
      return { ok: false, code: 'BUSY' }
    }

    const currentRun = this.stateSignal().run
    if (this.isActive(currentRun) && !replaceActive) {
      return { ok: false, code: 'BUSY' }
    }
    const now = Date.now()
    if (now - this.lastToolRunStartedAt < LATENCY_TEST_CONFIG.TOOL_RUN_COOLDOWN_MS) {
      return { ok: false, code: 'COOLDOWN' }
    }

    const generation = ++this.generation
    const runId = this.createRunId()
    this.pendingToolRun = {
      runId,
      generation,
      regions,
      targetSamples,
      replaceActive,
      previousRunId: currentRun?.runId ?? null,
      previousSelectionSignature: this.selectionSignature(this.regionService.selectedRegions())
    }
    return { ok: true, runId, generation }
  }

  commitToolRun(runId: string): boolean {
    const reservation = this.pendingToolRun
    const currentRun = this.stateSignal().run
    if (!reservation || reservation.runId !== runId || !this.viewActive) {
      return false
    }
    if (
      currentRun?.runId !== reservation.previousRunId &&
      (currentRun !== null || reservation.previousRunId !== null)
    ) {
      this.pendingToolRun = undefined
      return false
    }
    if (
      this.selectionSignature(this.regionService.selectedRegions()) !==
      reservation.previousSelectionSignature
    ) {
      this.pendingToolRun = undefined
      return false
    }
    if (this.isActive(currentRun) && !reservation.replaceActive) {
      this.pendingToolRun = undefined
      return false
    }

    const now = Date.now()
    const regions = reservation.regions
    this.pendingToolRun = undefined
    if (this.isActive(currentRun)) {
      this.finishRun('cancelled', 'replaced')
    }
    this.clearTerminalToolState()
    this.ignoredSelectionSignature = this.selectionSignature(regions)
    this.regionService.updateSelectedRegions(regions)
    this.warmedRegions.clear()
    this.runController = new AbortController()
    this.lastToolRunStartedAt = now
    this.stateSignal.set({
      regions: this.buildRegionMap(regions),
      revision: 0,
      run: {
        runId,
        owner: 'webmcp',
        status: 'running',
        generation: reservation.generation,
        targetSamples: reservation.targetSamples,
        rounds: 0,
        requestCount: 0,
        requestBudget: Math.min(regions.length * (reservation.targetSamples + 3), 352),
        startedAt: now,
        completedAt: null,
        deadlineAt: now + LATENCY_TEST_CONFIG.TOOL_RUN_DEADLINE_MS
      }
    })
    this.deadlineTimer = setTimeout(
      () => this.finishBoundedRunAtDeadline(runId, reservation.generation),
      LATENCY_TEST_CONFIG.TOOL_RUN_DEADLINE_MS
    )
    this.launchScheduler(runId, reservation.generation)
    return true
  }

  cancelToolRunReservation(runId: string, reason: string): void {
    const reservation = this.pendingToolRun
    if (!reservation || reservation.runId !== runId) {
      return
    }
    this.pendingToolRun = undefined
    if (reason) {
      this.generation += 1
    }
  }

  stopToolRun(runId: string): LatencyRunStatus | null {
    const run = this.stateSignal().run
    if (run?.owner === 'webmcp' && run.runId === runId) {
      if (!this.isActive(run) && this.isFreshToolRun(run)) {
        return run.status
      }
      if (this.isActive(run)) {
        this.finishRun('cancelled', 'tool_stopped')
        return 'cancelled'
      }
    }

    const terminal = this.getFreshTerminalToolState()
    return terminal?.run?.runId === runId ? terminal.run.status : null
  }

  calculateMedian(values: number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  }

  getCurrentState(): LatencyState {
    return this.cloneState(this.stateSignal())
  }

  getToolRunState(runId?: string): LatencyState | null {
    const current = this.stateSignal()
    if (
      current.run?.owner === 'webmcp' &&
      (!runId || current.run.runId === runId) &&
      this.isFreshToolRun(current.run)
    ) {
      return this.cloneState(current)
    }

    const terminal = this.getFreshTerminalToolState()
    if (terminal?.run && (!runId || terminal.run.runId === runId)) {
      return this.cloneState(terminal)
    }
    return null
  }

  private handleRegionSelection(regions: RegionModel[]): void {
    if (!this.viewActive) {
      return
    }

    const signature = this.selectionSignature(regions)
    if (this.ignoredSelectionSignature) {
      const shouldIgnoreSelection = signature === this.ignoredSelectionSignature
      this.ignoredSelectionSignature = ''
      if (shouldIgnoreSelection) {
        return
      }
    }

    if (this.pendingToolRun) {
      const reservation = this.pendingToolRun
      this.cancelToolRunReservation(reservation.runId, 'user_override')
    }

    const run = this.stateSignal().run
    if (run?.owner === 'webmcp' && this.isActive(run)) {
      this.finishRun('cancelled', 'user_override')
    }
    this.startOrUpdateHumanRun(regions)
  }

  private startOrUpdateHumanRun(regions: RegionModel[]): void {
    if (!regions.length) {
      this.cancelActiveRun('selection_cleared')
      this.warmedRegions.clear()
      this.stateSignal.set({ regions: new Map(), run: null, revision: 0 })
      return
    }

    const current = this.stateSignal()
    const currentRun = current.run
    if (currentRun?.owner === 'human' && currentRun.status === 'running') {
      this.stateSignal.update((state) => ({
        ...state,
        regions: this.buildRegionMap(regions, state.regions)
      }))
      return
    }

    this.cancelActiveRun('human_restart')
    const generation = ++this.generation
    const runId = this.createRunId()
    this.warmedRegions.clear()
    this.runController = new AbortController()
    this.stateSignal.set({
      regions: this.buildRegionMap(regions),
      revision: 0,
      run: {
        runId,
        owner: 'human',
        status: 'running',
        generation,
        targetSamples: null,
        rounds: 0,
        requestCount: 0,
        requestBudget: null,
        startedAt: Date.now(),
        completedAt: null,
        deadlineAt: null
      }
    })
    this.launchScheduler(runId, generation)
  }

  private launchScheduler(runId: string, generation: number): void {
    const signal = this.runController?.signal
    if (!signal) {
      return
    }
    void this.runScheduler(runId, generation, signal).catch((error: unknown) => {
      if (signal.aborted || !this.isCurrentRun(runId, generation)) {
        return
      }
      console.error('Latency test scheduler failed', error)
      this.finishRun('failed', 'scheduler_error')
    })
  }

  private async runScheduler(
    runId: string,
    generation: number,
    signal: AbortSignal
  ): Promise<void> {
    while (!signal.aborted && this.isCurrentRun(runId, generation)) {
      const state = this.stateSignal()
      const run = state.run
      if (!run || run.status !== 'running') {
        return
      }
      if (run.owner === 'human' && run.rounds >= LATENCY_TEST_CONFIG.MAX_HUMAN_ROUNDS) {
        this.finishRun('completed')
        return
      }
      if (run.owner === 'webmcp' && this.hasBoundedRunFinished(state)) {
        this.finishBoundedRun()
        return
      }

      const candidates = this.getCandidates(state)
      if (!candidates.length) {
        if (run.owner === 'webmcp' && !this.hasFutureBoundedCandidate(state)) {
          this.finishBoundedRun()
          return
        }
        await this.delay(this.nextRetryDelay(state), signal)
        continue
      }

      await this.pingRegions(candidates, runId, generation, signal)
      if (!this.isCurrentRun(runId, generation) || signal.aborted) {
        return
      }
      this.stateSignal.update((latest) => ({
        ...latest,
        run: latest.run ? { ...latest.run, rounds: latest.run.rounds + 1 } : null
      }))

      const latest = this.stateSignal()
      if (latest.run?.owner === 'webmcp' && this.hasBoundedRunFinished(latest)) {
        this.finishBoundedRun()
        return
      }
      await this.delay(LATENCY_TEST_CONFIG.PING_INTERVAL_MS, signal)
    }
  }

  private getCandidates(state: LatencyState): RegionPingData[] {
    const run = state.run
    if (!run) {
      return []
    }
    const now = Date.now()
    if (run.owner === 'human') {
      return Array.from(state.regions.values())
    }
    if ((run.requestBudget ?? 0) <= run.requestCount) {
      return []
    }
    const maxAttempts = (run.targetSamples ?? 0) + 3
    return Array.from(state.regions.values()).filter(
      (region) =>
        region.pingHistory.length < (run.targetSamples ?? 0) &&
        region.requestAttempts < maxAttempts &&
        region.nextAttemptAt <= now
    )
  }

  private hasFutureBoundedCandidate(state: LatencyState): boolean {
    const run = state.run
    if (!run || run.owner !== 'webmcp' || (run.requestBudget ?? 0) <= run.requestCount) {
      return false
    }
    const maxAttempts = (run.targetSamples ?? 0) + 3
    return Array.from(state.regions.values()).some(
      (region) =>
        region.pingHistory.length < (run.targetSamples ?? 0) && region.requestAttempts < maxAttempts
    )
  }

  private nextRetryDelay(state: LatencyState): number {
    const now = Date.now()
    const nextAttemptAt = Math.min(
      ...Array.from(state.regions.values())
        .map((region) => region.nextAttemptAt)
        .filter((value) => value > now)
    )
    if (!Number.isFinite(nextAttemptAt)) {
      return LATENCY_TEST_CONFIG.PING_INTERVAL_MS
    }
    return Math.max(1, Math.min(nextAttemptAt - now, LATENCY_TEST_CONFIG.PING_INTERVAL_MS))
  }

  private async pingRegions(
    regions: RegionPingData[],
    runId: string,
    generation: number,
    signal: AbortSignal
  ): Promise<void> {
    for (let index = 0; index < regions.length; index += LATENCY_TEST_CONFIG.CONCURRENT_PINGS) {
      if (signal.aborted || !this.isCurrentRun(runId, generation)) {
        return
      }
      const chunk = regions.slice(index, index + LATENCY_TEST_CONFIG.CONCURRENT_PINGS)
      await Promise.all(chunk.map((region) => this.pingRegion(region, runId, generation, signal)))
    }
  }

  private async pingRegion(
    candidate: RegionPingData,
    runId: string,
    generation: number,
    signal: AbortSignal
  ): Promise<void> {
    if (!candidate.url || !candidate.regionId || signal.aborted) {
      return
    }

    if (!this.warmedRegions.has(candidate.regionId)) {
      const warmResult = await this.performRequest(candidate, runId, generation, signal)
      if (warmResult !== 'success') {
        this.recordFailure(candidate.regionId, warmResult, runId, generation)
        return
      }
      if (!this.isCurrentRun(runId, generation) || signal.aborted) {
        return
      }
      this.warmedRegions.add(candidate.regionId)
    }

    const latest = this.stateSignal().regions.get(candidate.regionId)
    const run = this.stateSignal().run
    if (
      !latest ||
      (run?.owner === 'webmcp' &&
        latest.pingHistory.length >= (run.targetSamples ?? LATENCY_TEST_CONFIG.MAX_TOOL_SAMPLES))
    ) {
      return
    }

    const startedAt = performance.now()
    const pingResult = await this.performRequest(latest, runId, generation, signal)
    if (pingResult !== 'success') {
      this.recordFailure(candidate.regionId, pingResult, runId, generation)
      return
    }
    if (!this.isCurrentRun(runId, generation) || signal.aborted) {
      return
    }
    this.recordLatency(candidate.regionId, Math.round(performance.now() - startedAt))
  }

  private async performRequest(
    region: RegionPingData,
    runId: string,
    generation: number,
    signal: AbortSignal
  ): Promise<PingResult> {
    const releasePermit = await this.acquireRequestPermit(signal)
    if (!releasePermit) {
      return 'aborted'
    }
    if (!this.reserveRequest(region.regionId, runId, generation)) {
      releasePermit()
      return 'budget'
    }

    const controller = new AbortController()
    let timedOut = false
    let settlementGraceTimer: ReturnType<typeof setTimeout> | undefined
    const abortFromRun = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abortFromRun, { once: true })
    let resolveAbortFallback: ((result: PingResult) => void) | undefined
    const abortFallback = new Promise<PingResult>((resolve) => {
      resolveAbortFallback = resolve
    })
    const settleAfterAbortGrace = () => {
      settlementGraceTimer = setTimeout(
        () => resolveAbortFallback?.(signal.aborted ? 'aborted' : 'timeout'),
        LATENCY_TEST_CONFIG.REQUEST_SETTLEMENT_GRACE_MS
      )
    }
    controller.signal.addEventListener('abort', settleAfterAbortGrace, { once: true })
    const timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, LATENCY_TEST_CONFIG.PING_TIMEOUT_MS)

    try {
      const fetchResult = fetch(`${region.url}?_=${Date.now()}`, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-store',
        signal: controller.signal
      }).then(
        (): PingResult => {
          if (signal.aborted) return 'aborted'
          return timedOut ? 'timeout' : 'success'
        },
        (): PingResult => {
          if (signal.aborted) return 'aborted'
          return timedOut ? 'timeout' : 'network'
        }
      )
      return await Promise.race([fetchResult, abortFallback])
    } finally {
      clearTimeout(timeoutId)
      if (settlementGraceTimer) {
        clearTimeout(settlementGraceTimer)
      }
      controller.signal.removeEventListener('abort', settleAfterAbortGrace)
      signal.removeEventListener('abort', abortFromRun)
      releasePermit()
    }
  }

  private acquireRequestPermit(signal: AbortSignal): Promise<(() => void) | null> {
    if (signal.aborted) {
      return Promise.resolve(null)
    }
    if (this.activeRequestCount < LATENCY_TEST_CONFIG.CONCURRENT_PINGS) {
      this.activeRequestCount += 1
      return Promise.resolve(this.createPermitRelease())
    }

    return new Promise((resolve) => {
      const waiter: PermitWaiter = {
        signal,
        resolve,
        abort: () => {
          const index = this.permitQueue.indexOf(waiter)
          if (index >= 0) {
            this.permitQueue.splice(index, 1)
          }
          resolve(null)
        }
      }
      signal.addEventListener('abort', waiter.abort, { once: true })
      this.permitQueue.push(waiter)
    })
  }

  private createPermitRelease(): () => void {
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.activeRequestCount -= 1
      this.releaseNextPermit()
    }
  }

  private releaseNextPermit(): void {
    while (
      this.activeRequestCount < LATENCY_TEST_CONFIG.CONCURRENT_PINGS &&
      this.permitQueue.length
    ) {
      const waiter = this.permitQueue.shift()
      if (!waiter) {
        return
      }
      waiter.signal.removeEventListener('abort', waiter.abort)
      if (waiter.signal.aborted) {
        waiter.resolve(null)
        continue
      }
      this.activeRequestCount += 1
      waiter.resolve(this.createPermitRelease())
    }
  }

  private reserveRequest(regionId: string, runId: string, generation: number): boolean {
    const state = this.stateSignal()
    const run = state.run
    const region = state.regions.get(regionId)
    if (
      !region ||
      !run ||
      run.runId !== runId ||
      run.generation !== generation ||
      run.status !== 'running'
    ) {
      return false
    }
    if (run.requestBudget !== null && run.requestCount >= run.requestBudget) {
      return false
    }
    if (run.owner === 'webmcp' && region.requestAttempts >= (run.targetSamples ?? 0) + 3) {
      return false
    }

    const regions = new Map(state.regions)
    regions.set(regionId, { ...region, requestAttempts: region.requestAttempts + 1 })
    this.stateSignal.set({
      ...state,
      regions,
      run: { ...run, requestCount: run.requestCount + 1 }
    })
    return true
  }

  private recordFailure(
    regionId: string,
    result: PingResult,
    runId: string,
    generation: number
  ): void {
    if (result === 'aborted' || result === 'budget' || !this.isCurrentRun(runId, generation)) {
      return
    }
    this.stateSignal.update((state) => {
      const region = state.regions.get(regionId)
      if (!region) return state
      const failedAttempts = region.failedAttempts + 1
      const backoffMs = Math.min(
        LATENCY_TEST_CONFIG.PING_INTERVAL_MS * 2 ** Math.max(0, failedAttempts - 1),
        10_000
      )
      const regions = new Map(state.regions)
      regions.set(regionId, {
        ...region,
        failedAttempts,
        nextAttemptAt: Date.now() + backoffMs
      })
      return { ...state, regions }
    })
  }

  private recordLatency(regionId: string, latency: number): void {
    this.stateSignal.update((state) => {
      const region = state.regions.get(regionId)
      if (!region) return state
      const pingHistory = [...region.pingHistory, latency]
      if (pingHistory.length > LATENCY_TEST_CONFIG.MAX_PING_HISTORY) {
        pingHistory.shift()
      }
      const regions = new Map(state.regions)
      regions.set(regionId, {
        ...region,
        pingHistory,
        lastPingTime: Date.now(),
        failedAttempts: 0,
        nextAttemptAt: 0
      })
      return { ...state, regions, revision: state.revision + 1 }
    })
  }

  private hasBoundedRunFinished(state: LatencyState): boolean {
    const run = state.run
    if (!run || run.owner !== 'webmcp' || run.targetSamples === null) {
      return false
    }
    const targetSamples = run.targetSamples
    return Array.from(state.regions.values()).every(
      (region) => region.pingHistory.length >= targetSamples
    )
  }

  private finishBoundedRun(): void {
    const state = this.stateSignal()
    const run = state.run
    if (!run || run.owner !== 'webmcp') {
      return
    }
    const regions = Array.from(state.regions.values())
    const succeeded = regions.filter((region) => region.pingHistory.length > 0).length
    const completed = regions.filter(
      (region) => region.pingHistory.length >= (run.targetSamples ?? 0)
    ).length
    if (completed === regions.length) {
      this.finishRun('completed')
    } else if (succeeded > 0) {
      this.finishRun('partial', 'regions_unreachable')
    } else {
      this.finishRun('failed', 'no_regions_reachable')
    }
  }

  private finishBoundedRunAtDeadline(runId: string, generation: number): void {
    if (!this.isCurrentRun(runId, generation)) {
      return
    }
    this.finishBoundedRun()
  }

  private finishRun(status: LatencyRunStatus, reason?: string): void {
    const run = this.stateSignal().run
    if (!run || !this.isActive(run)) {
      return
    }
    this.clearDeadline()
    this.stateSignal.update((state) => ({
      ...state,
      run: state.run
        ? {
            ...state.run,
            status,
            completedAt: Date.now(),
            reason
          }
        : null
    }))
    const finishedState = this.stateSignal()
    if (finishedState.run?.owner === 'webmcp') {
      this.retainTerminalToolState(finishedState)
    }
    this.runController?.abort(reason)
    this.runController = undefined
    this.generation += 1
  }

  private cancelActiveRun(reason: string): void {
    const run = this.stateSignal().run
    if (this.isActive(run)) {
      this.finishRun('cancelled', reason)
    }
  }

  private clearDeadline(): void {
    if (this.deadlineTimer) {
      clearTimeout(this.deadlineTimer)
      this.deadlineTimer = undefined
    }
  }

  private retainTerminalToolState(state: LatencyState): void {
    const snapshot = this.cloneState(state)
    const runId = snapshot.run?.runId
    this.clearTerminalToolState()
    this.terminalToolStateSignal.set(snapshot)
    this.terminalSnapshotTimer = setTimeout(() => {
      if (this.terminalToolStateSignal()?.run?.runId === runId) {
        this.terminalToolStateSignal.set(null)
      }
      this.terminalSnapshotTimer = undefined
    }, LATENCY_TEST_CONFIG.TERMINAL_SNAPSHOT_TTL_MS)
  }

  private clearTerminalToolState(): void {
    if (this.terminalSnapshotTimer) {
      clearTimeout(this.terminalSnapshotTimer)
      this.terminalSnapshotTimer = undefined
    }
    this.terminalToolStateSignal.set(null)
  }

  private getFreshTerminalToolState(): LatencyState | null {
    const terminal = this.terminalToolStateSignal()
    if (!terminal?.run || !this.isFreshToolRun(terminal.run)) {
      if (terminal) {
        this.clearTerminalToolState()
      }
      return null
    }
    return terminal
  }

  private isFreshToolRun(run: LatencyRun): boolean {
    return (
      this.isActive(run) ||
      (run.completedAt !== null &&
        Date.now() - run.completedAt <= LATENCY_TEST_CONFIG.TERMINAL_SNAPSHOT_TTL_MS)
    )
  }

  private resolveViewActivationWaiters(active: boolean): void {
    for (const waiter of [...this.viewActivationWaiters]) {
      waiter(active)
    }
  }

  private isCurrentRun(runId: string, generation: number): boolean {
    const run = this.stateSignal().run
    return (
      run?.runId === runId &&
      run.generation === generation &&
      run.status === 'running' &&
      !this.runController?.signal.aborted
    )
  }

  private isActive(run: LatencyRun | null): boolean {
    return run?.status === 'starting' || run?.status === 'running'
  }

  private buildRegionMap(
    regions: RegionModel[],
    existingRegions: Map<string, RegionPingData> = new Map()
  ): Map<string, RegionPingData> {
    return new Map(
      regions
        .filter((region) => region.url && region.regionId)
        .map((region) => {
          const existing = existingRegions.get(region.regionId)
          return [
            region.regionId,
            {
              regionId: region.regionId,
              geography: region.geography,
              displayName: region.displayName,
              url: region.url,
              pingHistory: existing?.pingHistory ?? [],
              lastPingTime: existing?.lastPingTime ?? 0,
              requestAttempts: existing?.requestAttempts ?? 0,
              failedAttempts: existing?.failedAttempts ?? 0,
              nextAttemptAt: existing?.nextAttemptAt ?? 0
            }
          ]
        })
    )
  }

  private selectionSignature(regions: RegionModel[]): string {
    return regions
      .map((region) => region.regionId)
      .sort((a, b) => a.localeCompare(b))
      .join(',')
  }

  private createRunId(): string {
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    return `gcp-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`
  }

  private cloneState(state: LatencyState): LatencyState {
    return {
      regions: new Map(
        Array.from(state.regions.entries(), ([key, region]) => [
          key,
          { ...region, pingHistory: [...region.pingHistory] }
        ])
      ),
      run: state.run ? { ...state.run } : null,
      revision: state.revision
    }
  }

  private delay(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        signal.removeEventListener('abort', abort)
        resolve()
      }, milliseconds)
      const abort = () => {
        clearTimeout(timeoutId)
        resolve()
      }
      signal.addEventListener('abort', abort, { once: true })
    })
  }
}
