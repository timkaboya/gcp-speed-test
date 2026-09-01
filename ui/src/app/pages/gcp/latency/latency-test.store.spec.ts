import { PLATFORM_ID } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RegionModel } from '../../../models'
import { RegionService } from '../../../services'
import { LatencyTestStore } from './latency-test.store'

const makeRegion = (index = 1): RegionModel => ({
  regionId: `us-test${index}`,
  geography: 'North America',
  displayName: `Test Region ${index}`,
  url: `https://region-${index}.example`
})

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for test condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

describe('LatencyTestStore', () => {
  let store: LatencyTestStore
  let regionService: RegionService

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LatencyTestStore, RegionService, { provide: PLATFORM_ID, useValue: 'browser' }]
    })
    store = TestBed.inject(LatencyTestStore)
    regionService = TestBed.inject(RegionService)
  })

  afterEach(() => {
    store.deactivate()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('calculates a true median without dropping the highest small sample', () => {
    expect(store.calculateMedian([])).toBe(0)
    expect(store.calculateMedian([42])).toBe(42)
    expect(store.calculateMedian([10, 20, 100])).toBe(20)
    expect(store.calculateMedian([10, 20, 30, 100])).toBe(25)
    expect(store.calculateMedian([10, 11])).toBe(10.5)
  })

  it('warms a region then records a no-cors HEAD latency sample', async () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 12
      return now
    })
    const fetchMock = vi.fn().mockResolvedValue({} as Response)
    vi.stubGlobal('fetch', fetchMock)

    regionService.updateSelectedRegions([makeRegion()])
    store.activate()
    await waitUntil(() => store.tableData().length === 1)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, request] = fetchMock.mock.calls[0]
    expect(request).toMatchObject({
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store'
    })
    expect(store.tableData()[0].medianLatency).toBe(12)
  })

  it('never exceeds four total in-flight requests and does not overlap sweeps', async () => {
    const regions = Array.from({ length: 8 }, (_, index) => makeRegion(index + 1))
    let inFlight = 0
    let maxInFlight = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 2))
      inFlight -= 1
      return {} as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    regionService.updateSelectedRegions(regions)
    store.activate()
    await waitUntil(() => store.tableData().length === regions.length)
    store.deactivate()

    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(fetchMock).toHaveBeenCalledTimes(16)
    expect(store.isTestRunning()).toBe(false)
  })

  it('completes a bounded tool run at the requested sample target', async () => {
    vi.useFakeTimers()
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 10
      return now
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({} as Response))
    store.activate()

    const start = store.reserveToolRun([makeRegion()], 3, false)
    expect(start.ok).toBe(true)
    if (!start.ok) return
    expect(store.commitToolRun(start.runId)).toBe(true)

    await vi.runAllTimersAsync()

    expect(store.run()?.status).toBe('completed')
    expect(store.regionsWithMedian()[0].pingHistory).toHaveLength(3)
    expect(store.run()?.requestCount).toBe(4)
  })

  it('bounds failed requests and marks an unreachable tool run failed', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockRejectedValue(new Error('unreachable'))
    vi.stubGlobal('fetch', fetchMock)
    store.activate()

    const start = store.reserveToolRun([makeRegion()], 5, false)
    expect(start.ok).toBe(true)
    if (!start.ok) return
    store.commitToolRun(start.runId)

    await vi.runAllTimersAsync()

    expect(store.run()?.status).toBe('failed')
    expect(store.run()?.requestCount).toBe(8)
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(store.tableData()).toEqual([])
  })

  it('aborts in-flight work and records no late sample after stop', async () => {
    const requestSignals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, request: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const requestSignal = request.signal as AbortSignal
            requestSignals.push(requestSignal)
            requestSignal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )
    )
    store.activate()

    const start = store.reserveToolRun([makeRegion()], 3, false)
    expect(start.ok).toBe(true)
    if (!start.ok) return
    store.commitToolRun(start.runId)
    await waitUntil(() => requestSignals.length === 1)

    expect(store.stopToolRun(start.runId)).toBe('cancelled')
    await Promise.resolve()

    expect(requestSignals[0].aborted).toBe(true)
    expect(store.run()?.status).toBe('cancelled')
    expect(store.regionsWithMedian()[0].pingHistory).toEqual([])
  })

  it('treats a manual selection change as an override of a tool run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, request: RequestInit) => {
        const requestSignal = request.signal as AbortSignal
        return new Promise<Response>((_resolve, reject) => {
          requestSignal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        })
      })
    )
    store.activate()

    const start = store.reserveToolRun([makeRegion(1)], 3, false)
    expect(start.ok).toBe(true)
    if (!start.ok) return
    store.commitToolRun(start.runId)
    regionService.updateSelectedRegions([makeRegion(2)])
    TestBed.flushEffects()

    expect(store.run()?.owner).toBe('human')
    expect(Array.from(store.state().regions.keys())).toEqual(['us-test2'])
  })

  it('keeps an active human run intact when a replacement reservation is cancelled', async () => {
    const requestSignals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, request: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const requestSignal = request.signal as AbortSignal
            requestSignals.push(requestSignal)
            requestSignal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )
    )
    regionService.updateSelectedRegions([makeRegion(1)])
    store.activate()
    await waitUntil(() => requestSignals.length === 1)
    const humanRunId = store.run()?.runId

    const replacement = store.reserveToolRun([makeRegion(2)], 3, true)
    expect(replacement.ok).toBe(true)
    expect(store.run()?.runId).toBe(humanRunId)
    expect(requestSignals[0].aborted).toBe(false)
    if (!replacement.ok) return

    store.cancelToolRunReservation(replacement.runId, 'navigation_cancelled')

    expect(store.run()?.runId).toBe(humanRunId)
    expect(store.run()?.status).toBe('running')
    expect(requestSignals[0].aborted).toBe(false)
  })

  it('keeps global concurrency at four while replacing a run with unsettled requests', async () => {
    const initialRegions = Array.from({ length: 4 }, (_, index) => makeRegion(index + 1))
    const replacementRegions = Array.from({ length: 4 }, (_, index) => makeRegion(index + 11))
    let inFlight = 0
    let maxInFlight = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      return {} as Response
    })
    vi.stubGlobal('fetch', fetchMock)
    regionService.updateSelectedRegions(initialRegions)
    store.activate()
    await waitUntil(() => inFlight === 4)

    const replacement = store.reserveToolRun(replacementRegions, 1, true)
    expect(replacement.ok).toBe(true)
    if (!replacement.ok) return
    expect(store.commitToolRun(replacement.runId)).toBe(true)
    await waitUntil(() => store.run()?.status === 'completed')

    expect(maxInFlight).toBe(4)
    expect(
      store
        .tableData()
        .map((region) => region.regionId)
        .sort()
    ).toEqual(replacementRegions.map((region) => region.regionId).sort())
  })

  it('finishes at the deadline even when an underlying request ignores cancellation', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>(() => undefined))
    )
    store.activate()

    const start = store.reserveToolRun([makeRegion()], 3, false)
    expect(start.ok).toBe(true)
    if (!start.ok) return
    store.commitToolRun(start.runId)
    await vi.advanceTimersByTimeAsync(120_000)

    expect(store.run()?.status).toBe('failed')
    expect(store.run()?.reason).toBe('no_regions_reachable')
    expect(store.run()?.requestCount).toBe(6)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({} as Response))
    const next = store.reserveToolRun([makeRegion(2)], 1, false)
    expect(next.ok).toBe(true)
    if (!next.ok) return
    expect(store.commitToolRun(next.runId)).toBe(true)
    await vi.runAllTimersAsync()
    expect(store.run()?.status).toBe('completed')
  })

  it('enforces the 352-request global budget across all 44 regions', async () => {
    vi.useFakeTimers()
    const regions = Array.from({ length: 44 }, (_, index) => makeRegion(index + 1))
    const fetchMock = vi.fn().mockRejectedValue(new Error('unreachable'))
    vi.stubGlobal('fetch', fetchMock)
    store.activate()

    const start = store.reserveToolRun(regions, 5, false)
    expect(start.ok).toBe(true)
    if (!start.ok) return
    store.commitToolRun(start.runId)
    await vi.runAllTimersAsync()

    expect(store.run()?.status).toBe('failed')
    expect(store.run()?.requestCount).toBe(352)
    expect(fetchMock).toHaveBeenCalledTimes(352)
  })

  it('rejects invalid targets, concurrent starts, and starts during cooldown', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({} as Response))
    store.activate()

    expect(store.reserveToolRun([makeRegion()], 0, false)).toEqual({
      ok: false,
      code: 'INVALID_INPUT'
    })

    const first = store.reserveToolRun([makeRegion()], 1, false)
    expect(first.ok).toBe(true)
    expect(store.reserveToolRun([makeRegion(2)], 1, false)).toEqual({
      ok: false,
      code: 'BUSY'
    })
    if (!first.ok) return
    store.commitToolRun(first.runId)
    store.stopToolRun(first.runId)

    expect(store.reserveToolRun([makeRegion(2)], 1, false)).toEqual({
      ok: false,
      code: 'COOLDOWN'
    })
  })

  it('does not activate or issue requests on the server platform', () => {
    TestBed.resetTestingModule()
    TestBed.configureTestingModule({
      providers: [LatencyTestStore, RegionService, { provide: PLATFORM_ID, useValue: 'server' }]
    })
    const serverStore = TestBed.inject(LatencyTestStore)
    const serverRegions = TestBed.inject(RegionService)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    serverRegions.updateSelectedRegions([makeRegion()])

    serverStore.activate()

    expect(serverStore.isTestRunning()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    store = serverStore
  })
})
