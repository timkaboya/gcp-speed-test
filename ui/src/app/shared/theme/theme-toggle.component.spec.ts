import { PLATFORM_ID } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { ThemeToggleComponent } from './theme-toggle.component'

describe('ThemeToggleComponent', () => {
  let fixture: ComponentFixture<ThemeToggleComponent>
  let component: ThemeToggleComponent

  beforeEach(() => {
    localStorage.clear()
    TestBed.configureTestingModule({
      imports: [ThemeToggleComponent],
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }]
    })
    fixture = TestBed.createComponent(ThemeToggleComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('mounts and labels the toggle for switching to dark', () => {
    expect(component.ariaLabel()).toBe('Switch to dark theme')
  })

  it('updates the label after toggling the theme', () => {
    component.themeService.toggleTheme()
    fixture.detectChanges()
    expect(component.themeService.themeMode()).toBe('dark')
    expect(component.ariaLabel()).toBe('Switch to light theme')
  })

  it('toggles the theme when the button is clicked', () => {
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')
    button?.dispatchEvent(new MouseEvent('click'))
    expect(component.themeService.themeMode()).toBe('dark')
  })
})
