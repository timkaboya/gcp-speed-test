import { ComponentFixture, TestBed } from '@angular/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SUPPORT_TIERS } from '../constants'
import { PaystackService, DonateOptions } from './paystack.service'
import { SupportDeveloperComponent } from './support-developer.component'

describe('SupportDeveloperComponent', () => {
  let fixture: ComponentFixture<SupportDeveloperComponent>
  let component: SupportDeveloperComponent
  let donate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    donate = vi.fn().mockResolvedValue(undefined)
    TestBed.configureTestingModule({
      imports: [SupportDeveloperComponent],
      providers: [{ provide: PaystackService, useValue: { donate } }]
    })
    fixture = TestBed.createComponent(SupportDeveloperComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the trigger button and starts with the dialog closed', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? ''
    expect(text).toContain('Buy me a coffee')
    expect(component.isOpen()).toBe(false)
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]')).toBeNull()
  })

  it('defaults to the middle preset tier as a valid amount', () => {
    expect(component.amount()).toBe(SUPPORT_TIERS[1])
    expect(component.isValid()).toBe(true)
  })

  it('renders the compact header variant without the section heading', () => {
    fixture.componentRef.setInput('variant', 'compact')
    fixture.detectChanges()
    const host = fixture.nativeElement as HTMLElement
    const trigger = host.querySelector('button[aria-label="Buy me a coffee"]')
    expect(trigger).not.toBeNull()
    expect(host.textContent).not.toContain('Support the developer')

    trigger?.dispatchEvent(new MouseEvent('click'))
    fixture.detectChanges()
    expect(component.isOpen()).toBe(true)
    expect(host.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('opens the dialog and resets status to idle', () => {
    component.status.set('error')
    component.open()
    fixture.detectChanges()
    expect(component.isOpen()).toBe(true)
    expect(component.status()).toBe('idle')
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('selecting a tier sets the amount and clears the custom field', () => {
    component.onCustomInput('42')
    component.selectTier(SUPPORT_TIERS[0])
    expect(component.amount()).toBe(SUPPORT_TIERS[0])
    expect(component.customValue()).toBe('')
    expect(component.isTierActive(SUPPORT_TIERS[0])).toBe(true)
  })

  it('accepts a valid custom amount and floors it to whole dollars', () => {
    component.onCustomInput('7.9')
    expect(component.amount()).toBe(7)
    expect(component.customValue()).toBe('7.9')
    expect(component.isTierActive(SUPPORT_TIERS[0])).toBe(false)
  })

  it('rejects empty, non-numeric, or below-minimum custom amounts', () => {
    component.onCustomInput('')
    expect(component.amount()).toBeNull()
    expect(component.isValid()).toBe(false)

    component.onCustomInput('abc')
    expect(component.amount()).toBeNull()

    component.onCustomInput('0')
    expect(component.amount()).toBeNull()
  })

  it('donates the selected amount in cents and reports success', async () => {
    component.selectTier(SUPPORT_TIERS[0])
    await component.donate()

    expect(donate).toHaveBeenCalledTimes(1)
    const options = donate.mock.calls[0][0] as DonateOptions
    expect(options.amountCents).toBe(SUPPORT_TIERS[0] * 100)

    options.onSuccess?.({})
    expect(component.status()).toBe('success')
  })

  it('treats a blank email as valid and sends no email override', async () => {
    expect(component.isEmailValid()).toBe(true)
    await component.donate()
    const options = donate.mock.calls[0][0] as DonateOptions
    expect(options.email).toBeUndefined()
  })

  it('passes a provided email through to Paystack', async () => {
    component.email.set('donor@example.com')
    expect(component.isEmailValid()).toBe(true)
    await component.donate()
    const options = donate.mock.calls[0][0] as DonateOptions
    expect(options.email).toBe('donor@example.com')
  })

  it('rejects an invalid email and blocks the donation', async () => {
    component.email.set('not-an-email')
    expect(component.isEmailValid()).toBe(false)
    expect(component.isValid()).toBe(false)
    await component.donate()
    expect(donate).not.toHaveBeenCalled()
  })

  it('returns to idle when the Paystack popup is cancelled', async () => {
    await component.donate()
    const options = donate.mock.calls[0][0] as DonateOptions
    options.onCancel?.()
    expect(component.status()).toBe('idle')
  })

  it('does not donate when the amount is invalid', async () => {
    component.onCustomInput('')
    await component.donate()
    expect(donate).not.toHaveBeenCalled()
  })

  it('shows an error message when the payment fails to start', async () => {
    donate.mockRejectedValueOnce(new Error('boom'))
    await component.donate()
    expect(component.status()).toBe('error')
    expect(component.errorMessage()).not.toBe('')
  })
})
