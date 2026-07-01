import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { beforeEach, describe, expect, it } from 'vitest'

import { App } from './app'

describe('App', () => {
  let component: App

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])]
    })
    component = TestBed.createComponent(App).componentInstance
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
})
