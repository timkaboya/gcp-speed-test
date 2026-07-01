import { ComponentFixture, TestBed } from '@angular/core/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { ConnectionDetailsComponent } from './connection-details.component'

describe('ConnectionDetailsComponent', () => {
  let fixture: ComponentFixture<ConnectionDetailsComponent>
  let component: ConnectionDetailsComponent

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConnectionDetailsComponent]
    })
    fixture = TestBed.createComponent(ConnectionDetailsComponent)
    component = fixture.componentInstance
    fixture.componentRef.setInput('isVisible', true)
    fixture.componentRef.setInput('isLoading', false)
    fixture.componentRef.setInput('error', null)
    fixture.componentRef.setInput('networkLabel', 'Google LLC (AS15169)')
    fixture.componentRef.setInput('locationLabel', 'Mountain View, US')
    fixture.componentRef.setInput('ipLabel', '1.2.3.4')
    fixture.detectChanges()
  })

  it('renders the expanded content with labels when visible', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? ''
    expect(text).toContain('Google LLC (AS15169)')
    expect(text).toContain('Mountain View, US')
    expect(text).toContain('1.2.3.4')
  })

  it('hides the details content when not visible', () => {
    fixture.componentRef.setInput('isVisible', false)
    fixture.detectChanges()
    const content = (fixture.nativeElement as HTMLElement).querySelector(
      '#connection-details-content'
    )
    expect(content).toBeNull()
  })

  it('emits toggleVisibility when the header button is clicked', () => {
    let emitted = false
    component.toggleVisibility.subscribe(() => (emitted = true))
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')
    button?.dispatchEvent(new MouseEvent('click'))
    expect(emitted).toBe(true)
  })
})
