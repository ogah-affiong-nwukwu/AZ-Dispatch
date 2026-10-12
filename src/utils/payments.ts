import type { PaymentResult } from '../types'

export function createFlwReference(): string {
  const random = Math.floor(1000 + Math.random() * 9000)
  const stamp = Date.now().toString(36).toUpperCase()
  return `FLW-MOCK-${stamp}-${random}`
}

export function processTestPayment(amountNgn: number): Promise<PaymentResult> {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve({
        reference: createFlwReference(),
        amount: amountNgn,
        currency: 'NGN',
        status: 'successful',
        processor: 'flutterwave-test',
        paidAt: new Date().toISOString(),
      })
    }, 1800)
  })
}
