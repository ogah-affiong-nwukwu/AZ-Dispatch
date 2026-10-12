import { useEffect, useState } from 'react'
import type { BoostItem, PaymentResult } from '../types'
import { formatNgnExact } from '../utils/format'
import { processTestPayment } from '../utils/payments'
import {
  IconCheckCircle,
  IconCreditCard,
  IconInfo,
  IconShieldCheck,
  IconX,
} from './Icons'
import './../styles/flutterwave.css'

type PaymentStep = 'review' | 'processing' | 'success'

interface FlutterwaveModalProps {
  item: BoostItem
  payerName: string
  payerEmail: string
  onClose: () => void
  onSuccess: (reference: string) => void
}

export function FlutterwaveModal({
  item,
  payerName,
  payerEmail,
  onClose,
  onSuccess,
}: FlutterwaveModalProps) {
  const [step, setStep] = useState<PaymentStep>('review')
  const [result, setResult] = useState<PaymentResult | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && step === 'review') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [step, onClose])

  const handlePay = async () => {
    setStep('processing')
    const payment = await processTestPayment(item.budgetNgn)
    setResult(payment)
    setStep('success')
  }

  const handleDone = () => {
    if (result) onSuccess(result.reference)
    onClose()
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-card__head">
          <span className="flw-mark">FLW</span>
          <strong>Flutterwave Checkout</strong>
          <span className="test-chip">TEST MODE</span>
          {step === 'review' && (
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Close payment modal"
            >
              <IconX size={16} />
            </button>
          )}
        </div>

        {step === 'review' && (
          <>
            <div className="modal-card__body">
              <div className="pay-merchant">
                <span className="pay-merchant__logo">
                  <IconShieldCheck size={19} />
                </span>
                <span>
                  <strong>AZ Delivery &amp; Logistics Hub</strong>
                  <span>Advertising &amp; boost campaign</span>
                </span>
              </div>

              <div className="pay-amount">
                <small>You are paying</small>
                <strong>{formatNgnExact(item.budgetNgn)}</strong>
              </div>

              <div className="pay-details">
                <div className="pay-row">
                  <span>Campaign</span>
                  <span>{item.title}</span>
                </div>
                <div className="pay-row">
                  <span>Type</span>
                  <span>
                    {item.kind === 'listing'
                      ? 'Business listing'
                      : 'Delivery boost'}
                  </span>
                </div>
                <div className="pay-row">
                  <span>Payer</span>
                  <span>{payerName}</span>
                </div>
                <div className="pay-row">
                  <span>Email</span>
                  <span>{payerEmail}</span>
                </div>
                <div className="pay-row">
                  <span>Reach</span>
                  <span>{item.audience}</span>
                </div>
              </div>

              <p className="pay-note">
                <IconInfo size={14} />
                Sandbox transaction — no real money will be debited.
              </p>

              <div className="modal-card__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={handlePay}
                >
                  <IconCreditCard size={16} />
                  Pay {formatNgnExact(item.budgetNgn)}
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'processing' && (
          <div className="modal-card__body">
            <div className="pay-processing">
              <span className="spinner" aria-hidden="true" />
              <strong>Processing payment…</strong>
              <p>
                Contacting the Flutterwave sandbox and authorising your test
                card.
              </p>
            </div>
          </div>
        )}

        {step === 'success' && result && (
          <div className="modal-card__body">
            <div className="pay-success">
              <IconCheckCircle size={54} className="pay-success__check" />
              <h3>Payment successful</h3>
              <p>
                Your campaign <strong>{item.title}</strong> is now active and
                live in the marketplace.
              </p>
              <span className="pay-ref">{result.reference}</span>
              <p>
                {formatNgnExact(result.amount)} · {result.currency} ·{' '}
                {result.processor}
              </p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleDone}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
