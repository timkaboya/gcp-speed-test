import { PLATFORM_ID } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PAYSTACK_PUBLIC_KEY,
  SUPPORT_CURRENCY,
  SUPPORT_EMAIL
} from '../constants'
import { PaystackService } from './paystack.service'

describe('PaystackService', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['PaystackPop']
    vi.restoreAllMocks()
  })

  describe('in the browser', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [PaystackService] })
    })

    it('launches a transaction with the configured key, email, amount and currency', async () => {
      const newTransaction = vi.fn()
      class MockPop {
        newTransaction = newTransaction
      }
      ;(window as unknown as Record<string, unknown>)['PaystackPop'] = MockPop

      const service = TestBed.inject(PaystackService)
      const onSuccess = vi.fn()
      const onCancel = vi.fn()
      await service.donate({ amountCents: 500, onSuccess, onCancel })

      expect(newTransaction).toHaveBeenCalledTimes(1)
      expect(newTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          key: PAYSTACK_PUBLIC_KEY,
          email: SUPPORT_EMAIL,
          amount: 500,
          currency: SUPPORT_CURRENCY,
          onSuccess,
          onCancel
        })
      )
    })
  })

  describe('on the server', () => {
    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [PaystackService, { provide: PLATFORM_ID, useValue: 'server' }]
      })
    })

    it('rejects rather than touching the DOM', async () => {
      const service = TestBed.inject(PaystackService)
      await expect(service.donate({ amountCents: 500 })).rejects.toThrow()
    })
  })
})
