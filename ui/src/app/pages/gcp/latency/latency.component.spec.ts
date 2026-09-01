import { provideHttpClient } from '@angular/common/http'
import { PLATFORM_ID } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RegionService } from '../../../services'
import { LatencyTestStore } from './latency-test.store'
import { LatencyComponent } from './latency.component'

interface LatencyViewInternals {
  getLatencyBadgeState(latency: number | null | undefined): string
  trackByRegionData(index: number, item: { regionId: string; displayName: string }): string
}

const viewInternals = (component: LatencyComponent): LatencyViewInternals =>
  component as unknown as LatencyViewInternals

describe('LatencyComponent', () => {
  let fixture: ComponentFixture<LatencyComponent>
  let component: LatencyComponent
  let store: LatencyTestStore

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [LatencyComponent],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' }
      ]
    })
    fixture = TestBed.createComponent(LatencyComponent)
    component = fixture.componentInstance
    store = TestBed.inject(LatencyTestStore)
  })

  afterEach(() => {
    fixture.destroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('classifies latency bands and unknown values', () => {
    const view = viewInternals(component)
    expect(view.getLatencyBadgeState(null)).toBe('unknown')
    expect(view.getLatencyBadgeState(0)).toBe('unknown')
    expect(view.getLatencyBadgeState(50)).toBe('fast')
    expect(view.getLatencyBadgeState(150)).toBe('moderate')
    expect(view.getLatencyBadgeState(400)).toBe('slow')
  })

  it('tracks result rows by region ID with display name as fallback', () => {
    const view = viewInternals(component)
    expect(view.trackByRegionData(0, { regionId: 'us-east1', displayName: 'South Carolina' })).toBe(
      'us-east1'
    )
    expect(view.trackByRegionData(0, { regionId: '', displayName: 'Unknown' })).toBe('Unknown')
  })

  it('uses the shared latency store for visible result signals', () => {
    expect(component.tableData).toBe(store.tableData)
    expect(component.bestRegion).toBe(store.bestRegion)
    expect(component.isTestRunning).toBe(store.isTestRunning)
  })

  it('activates the store on init and deactivates it on destroy', () => {
    const activate = vi.spyOn(store, 'activate')
    const deactivate = vi.spyOn(store, 'deactivate')

    fixture.detectChanges()
    expect(activate).toHaveBeenCalledOnce()

    fixture.destroy()
    expect(deactivate).toHaveBeenCalledOnce()
  })

  it('does not show a loading skeleton after a run has stopped without results', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, request: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = request.signal as AbortSignal
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            )
          })
      )
    )
    const regionService = TestBed.inject(RegionService)
    regionService.updateSelectedRegions([regionService.regions()[0]])
    fixture.detectChanges()
    TestBed.flushEffects()
    expect(component.shouldShowLatencySkeleton()).toBe(true)

    store.deactivate()
    fixture.detectChanges()

    expect(component.shouldShowLatencySkeleton()).toBe(false)
    expect(fixture.nativeElement.textContent).toContain('No latency data received')
  })
})
