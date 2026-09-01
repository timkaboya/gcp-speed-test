import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './app'
import { LatencyTestStore } from './pages/gcp/latency/latency-test.store'
import { RegionService } from './services'

describe('App', () => {
  let component: App
  let fixture: ComponentFixture<App>

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])]
    })
    fixture = TestBed.createComponent(App)
    component = fixture.componentInstance
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('starts with the mobile nav closed and no route loader', () => {
    expect(component.mobileNavOpen()).toBe(false)
    expect(component.isRouteLoading()).toBe(false)
    expect(component.showRouteLoader()).toBe(false)
  })

  it('toggles and closes the mobile nav', () => {
    component.toggleMobileNav()
    expect(component.mobileNavOpen()).toBe(true)
    component.toggleMobileNav()
    expect(component.mobileNavOpen()).toBe(false)

    component.toggleMobileNav()
    component.closeMobileNav()
    expect(component.mobileNavOpen()).toBe(false)
  })

  it('closes the mobile nav after navigating', () => {
    component.toggleMobileNav()
    component.handleMobileNavigate()
    expect(component.mobileNavOpen()).toBe(false)
  })

  it('closes the mobile nav on escape only when open', () => {
    component.handleEscapeKey()
    expect(component.mobileNavOpen()).toBe(false)

    component.toggleMobileNav()
    component.handleEscapeKey()
    expect(component.mobileNavOpen()).toBe(false)
  })

  it('exposes navigation groups', () => {
    expect(component.navGroups().length).toBeGreaterThan(0)
  })

  it('shows an accessible visible status when a Site tool starts a test', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>(() => undefined))
    )
    const store = TestBed.inject(LatencyTestStore)
    const region = TestBed.inject(RegionService).regions()[0]
    store.activate()
    const start = store.reserveToolRun([region], 1, false)
    expect(start.ok).toBe(true)
    if (!start.ok) return
    store.commitToolRun(start.runId)

    fixture.detectChanges()

    const status = fixture.nativeElement.querySelector('[role="status"]') as HTMLElement
    expect(status).toBeTruthy()
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('Site tool is testing latency')
    store.deactivate()
  })
})
