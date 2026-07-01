import { provideHttpClient } from '@angular/common/http'
import { PLATFORM_ID } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LatencyComponent } from './latency.component'

interface RegionPingData {
  regionId: string
  geography: string
  displayName: string
  url: string
  pingHistory: number[]
  lastPingTime: number
}

// Typed access to the private members exercised by these tests, avoiding `any`.
interface LatencyInternals {
  calculateMedian(values: number[]): number
  getLatencyBadgeState(latency: number | null | undefined): string
  sendPing(url: string): Promise<boolean>
  pingRegion(region: RegionPingData): Promise<void>
  queuePingUpdate(regionId: string, latency: number): void
  flushPingUpdates(): void
  warmedRegions: Set<string>
  pendingPingUpdates: Map<string, number>
  state: {
    set(value: {
      regions: Map<string, RegionPingData>
      pingAttemptCount: number
      isTestRunning: boolean
    }): void
  }
}

function internals(component: LatencyComponent): LatencyInternals {
  return component as unknown as LatencyInternals
}

function makeRegion(overrides: Partial<RegionPingData> = {}): RegionPingData {
  return {
    regionId: 'us-east1',
    geography: 'Americas',
    displayName: 'South Carolina',
    url: 'https://endpoint.example',
    pingHistory: [],
    lastPingTime: 0,
    ...overrides
  }
}

describe('LatencyComponent', () => {
  let fixture: ComponentFixture<LatencyComponent>
  let component: LatencyComponent

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LatencyComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    })
    // RegionService now loads its region list synchronously from the bundled
    // endpoints data, so there is no HTTP request to flush here. Tests that need
    // an active selection set component state directly.
    fixture = TestBed.createComponent(LatencyComponent)
    component = fixture.componentInstance
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('calculateMedian', () => {
    it('returns 0 for an empty sample', () => {
      expect(internals(component).calculateMedian([])).toBe(0)
    })

    it('returns the only value for a single sample', () => {
      expect(internals(component).calculateMedian([42])).toBe(42)
    })

    it('drops the highest value for small (3-5) samples', () => {
      // [10, 20, 100] -> highest removed -> median of [10, 20] = 15
      expect(internals(component).calculateMedian([10, 20, 100])).toBe(15)
    })

    it('uses the IQR method for larger samples', () => {
      const values = [10, 12, 11, 13, 12, 500]
      expect(internals(component).calculateMedian(values)).toBeGreaterThan(0)
      // The 500ms outlier is filtered out of the median.
      expect(internals(component).calculateMedian(values)).toBeLessThan(100)
    })
  })

  describe('getLatencyBadgeState', () => {
    it('classifies latency bands and unknown values', () => {
      const priv = internals(component)
      expect(priv.getLatencyBadgeState(null)).toBe('unknown')
      expect(priv.getLatencyBadgeState(0)).toBe('unknown')
      expect(priv.getLatencyBadgeState(50)).toBe('fast')
      expect(priv.getLatencyBadgeState(150)).toBe('moderate')
      expect(priv.getLatencyBadgeState(400)).toBe('slow')
    })
  })

  describe('sendPing', () => {
    it('issues a no-cors HEAD request with no-store caching and resolves true', async () => {
      const fetchMock = vi.fn().mockResolvedValue({} as Response)
      vi.stubGlobal('fetch', fetchMock)

      const result = await internals(component).sendPing('https://endpoint.example')

      expect(result).toBe(true)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toContain('https://endpoint.example')
      expect(init.method).toBe('HEAD')
      // no-cors + no-store avoids a CORS preflight against Cloud Run endpoints.
      expect(init.mode).toBe('no-cors')
      expect(init.cache).toBe('no-store')
    })

    it('resolves false when the request rejects', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
      expect(await internals(component).sendPing('https://endpoint.example')).toBe(false)
    })
  })

  describe('pingRegion', () => {
    it('does not mark a region warmed when the warm-up ping fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('cold')))
      const priv = internals(component)

      await priv.pingRegion(makeRegion())

      expect(priv.warmedRegions.has('us-east1')).toBe(false)
      expect(priv.pendingPingUpdates.size).toBe(0)
    })

    it('records a large latency (no upper cap) once the region is warmed', async () => {
      // First call = warm-up (success), second call = timed request (success).
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({} as Response))
      // 5000ms round trip: start=1000, end=6000.
      vi.spyOn(performance, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(6000)
      const priv = internals(component)

      await priv.pingRegion(makeRegion())

      expect(priv.warmedRegions.has('us-east1')).toBe(true)
      expect(priv.pendingPingUpdates.get('us-east1')).toBe(5000)
    })

    it('skips regions without a url or id', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await internals(component).pingRegion(makeRegion({ url: '' }))
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('flushPingUpdates', () => {
    it('appends queued latencies to region ping history and computes a median', () => {
      const priv = internals(component)
      const region = makeRegion()
      priv.state.set({
        regions: new Map([[region.regionId, region]]),
        pingAttemptCount: 0,
        isTestRunning: false
      })

      priv.queuePingUpdate('us-east1', 5000)
      priv.flushPingUpdates()

      const row = component.regionsWithMedian().find((r) => r.regionId === 'us-east1')
      expect(row?.pingHistory).toContain(5000)
      expect(row?.currentLatency).toBe(5000)
      expect(row?.medianLatency).toBe(5000)
    })
  })

  describe('csvRows', () => {
    it('is null with no data and populated once regions have latency', () => {
      const priv = internals(component)
      expect(component.csvRows()).toBeNull()

      const region = makeRegion({ pingHistory: [12, 14, 13] })
      priv.state.set({
        regions: new Map([[region.regionId, region]]),
        pingAttemptCount: 0,
        isTestRunning: false
      })

      const rows = component.csvRows()
      expect(rows).not.toBeNull()
      expect(rows![0][2]).toBe('us-east1')
    })
  })
})
