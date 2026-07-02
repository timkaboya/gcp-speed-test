import { isPlatformBrowser } from '@angular/common'
import { DOCUMENT, inject, Injectable, PLATFORM_ID } from '@angular/core'

import { PAYSTACK_PUBLIC_KEY, SUPPORT_CURRENCY, SUPPORT_EMAIL } from '../constants'

const PAYSTACK_SCRIPT_URL = 'https://js.paystack.co/v2/inline.js'

interface PaystackTransactionOptions {
  key: string
  email: string
  /** Amount in the smallest currency subunit (e.g. cents for USD). */
  amount: number
  currency: string
  onSuccess?: (transaction: unknown) => void
  onCancel?: () => void
}

interface PaystackPopInstance {
  newTransaction(options: PaystackTransactionOptions): void
}

type PaystackPopConstructor = new () => PaystackPopInstance

interface PaystackWindow extends Window {
  PaystackPop?: PaystackPopConstructor
}

export interface DonateOptions {
  /** Amount in the smallest currency subunit (cents for USD). */
  amountCents: number
  onSuccess?: (transaction: unknown) => void
  onCancel?: () => void
}

/**
 * Loads the Paystack Inline (v2) script on demand and launches the secure
 * on-site checkout popup. The script is only injected in the browser and only
 * on first use, so it never affects initial page load or layout stability.
 */
@Injectable({ providedIn: 'root' })
export class PaystackService {
  private readonly document = inject(DOCUMENT)
  private readonly platformId = inject(PLATFORM_ID)
  private loadPromise?: Promise<PaystackPopConstructor>

  private getWindow(): PaystackWindow | null {
    return (this.document.defaultView as PaystackWindow | null) ?? null
  }

  private load(): Promise<PaystackPopConstructor> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.reject(new Error('Paystack is only available in the browser'))
    }

    const existing = this.getWindow()?.PaystackPop
    if (existing) {
      return Promise.resolve(existing)
    }

    if (this.loadPromise) {
      return this.loadPromise
    }

    this.loadPromise = new Promise<PaystackPopConstructor>((resolve, reject) => {
      const script = this.document.createElement('script')
      script.src = PAYSTACK_SCRIPT_URL
      script.async = true
      script.onload = () => {
        const ctor = this.getWindow()?.PaystackPop
        if (ctor) {
          resolve(ctor)
        } else {
          this.loadPromise = undefined
          reject(new Error('PaystackPop was not available after loading the script'))
        }
      }
      script.onerror = () => {
        this.loadPromise = undefined
        reject(new Error('Failed to load the Paystack checkout script'))
      }
      this.document.head.appendChild(script)
    })

    return this.loadPromise
  }

  async donate(options: DonateOptions): Promise<void> {
    const PaystackPop = await this.load()
    const popup = new PaystackPop()
    popup.newTransaction({
      key: PAYSTACK_PUBLIC_KEY,
      email: SUPPORT_EMAIL,
      amount: options.amountCents,
      currency: SUPPORT_CURRENCY,
      onSuccess: options.onSuccess,
      onCancel: options.onCancel
    })
  }
}
