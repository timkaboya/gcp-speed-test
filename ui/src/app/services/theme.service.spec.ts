import { ApplicationRef, DOCUMENT, PLATFORM_ID } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ThemeService } from './theme.service'

function createService(platform: string): { service: ThemeService; document: Document } {
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: platform }]
  })
  const service = TestBed.inject(ThemeService)
  const document = TestBed.inject(DOCUMENT)
  return { service, document }
}

// Effects (persistence + DOM class) run on the next tick, so flush after acting.
function flushEffects(): void {
  TestBed.inject(ApplicationRef).tick()
}

describe('ThemeService (browser)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('defaults to light theme', () => {
    const { service } = createService('browser')
    expect(service.themeMode()).toBe('light')
  })

  it('toggles from light to dark, applies the class and persists the value', () => {
    const { service, document } = createService('browser')
    service.toggleTheme()
    flushEffects()

    expect(service.themeMode()).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('THEME')).toBe('dark')
  })

  it('toggles back from dark to light and removes the class', () => {
    const { service, document } = createService('browser')
    service.toggleTheme()
    service.toggleTheme()
    flushEffects()

    expect(service.themeMode()).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('THEME')).toBe('light')
  })

  it('initializes from a stored dark theme', () => {
    localStorage.setItem('THEME', 'dark')
    const { service, document } = createService('browser')
    // ensureInitialized runs inside toggleTheme, reading storage first.
    service.toggleTheme()
    flushEffects()
    // Stored dark -> initialized dark -> toggled to light.
    expect(service.themeMode()).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('ignores an invalid stored theme value', () => {
    localStorage.setItem('THEME', 'purple')
    const { service } = createService('browser')
    service.toggleTheme()
    expect(service.themeMode()).toBe('dark')
  })
})

describe('ThemeService (server)', () => {
  it('still toggles the signal without touching the DOM', () => {
    const { service } = createService('server')
    service.toggleTheme()
    expect(service.themeMode()).toBe('dark')
  })
})
