import { ComponentFixture, TestBed } from '@angular/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CopyButtonComponent } from './copy-button.component'

describe('CopyButtonComponent', () => {
  let fixture: ComponentFixture<CopyButtonComponent>
  let component: CopyButtonComponent

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CopyButtonComponent] })
    fixture = TestBed.createComponent(CopyButtonComponent)
    component = fixture.componentInstance
    fixture.componentRef.setInput('text', 'copy me')
    fixture.detectChanges()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('mounts in the idle state showing the label', () => {
    expect(component.isCopyIdle()).toBe(true)
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Copy')
  })

  it('copies text and shows the success state', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await component.copy()

    expect(writeText).toHaveBeenCalledWith('copy me')
    expect(component.isCopySuccess()).toBe(true)
  })

  it('does nothing when there is no text', async () => {
    const writeText = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    fixture.componentRef.setInput('text', '')

    await component.copy()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('disables the button when there is no text', () => {
    fixture.componentRef.setInput('text', '')
    fixture.detectChanges()
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')
    expect(button?.disabled).toBe(true)
  })

  it('resets to idle when resetOn changes after a successful copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await component.copy()
    expect(component.isCopySuccess()).toBe(true)

    fixture.componentRef.setInput('resetOn', Symbol('changed'))
    fixture.detectChanges()
    expect(component.isCopyIdle()).toBe(true)
  })
})
