import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  NgZone,
  signal
} from '@angular/core'

import { LucideIconComponent } from '../icons/lucide-icons.component'
import { SUPPORT_CURRENCY, SUPPORT_TIERS } from '../constants'
import { PaystackService } from './paystack.service'

type DonationStatus = 'idle' | 'processing' | 'success' | 'error'

@Component({
  selector: 'app-support-developer',
  imports: [LucideIconComponent],
  templateUrl: './support-developer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SupportDeveloperComponent {
  private readonly paystack = inject(PaystackService)
  private readonly zone = inject(NgZone)

  readonly tiers = SUPPORT_TIERS
  readonly currency = SUPPORT_CURRENCY

  readonly isOpen = signal(false)
  readonly status = signal<DonationStatus>('idle')
  readonly errorMessage = signal('')

  /** Selected whole-dollar amount. Null when the custom amount is invalid. */
  readonly amount = signal<number | null>(SUPPORT_TIERS[1] ?? SUPPORT_TIERS[0])

  /** Raw text of the custom amount field ('' means a preset tier is active). */
  readonly customValue = signal('')

  readonly isProcessing = computed(() => this.status() === 'processing')

  readonly isValid = computed(() => {
    const value = this.amount()
    return value !== null && value >= 1
  })

  isTierActive(tier: number): boolean {
    return this.customValue() === '' && this.amount() === tier
  }

  open(): void {
    this.status.set('idle')
    this.errorMessage.set('')
    this.isOpen.set(true)
  }

  close(): void {
    this.isOpen.set(false)
  }

  selectTier(tier: number): void {
    this.customValue.set('')
    this.amount.set(tier)
  }

  onCustomInput(value: string): void {
    this.customValue.set(value)
    const parsed = Number(value)
    if (value.trim() === '' || Number.isNaN(parsed) || parsed < 1) {
      this.amount.set(null)
      return
    }
    this.amount.set(Math.floor(parsed))
  }

  async donate(): Promise<void> {
    const value = this.amount()
    if (value === null || value < 1 || this.isProcessing()) {
      return
    }

    this.status.set('processing')
    this.errorMessage.set('')

    try {
      await this.paystack.donate({
        amountCents: Math.round(value * 100),
        onSuccess: () => this.zone.run(() => this.status.set('success')),
        onCancel: () => this.zone.run(() => this.status.set('idle'))
      })
    } catch {
      this.zone.run(() => {
        this.status.set('error')
        this.errorMessage.set('We could not start the payment. Please try again.')
      })
    }
  }
}
