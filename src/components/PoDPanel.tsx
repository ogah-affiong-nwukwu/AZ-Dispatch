import { useState } from 'react'
import type {
  Delivery,
  GeofenceResult,
  NotifyFn,
  OtpVerification,
} from '../types'
import { GEOFENCE_RADIUS_METERS, mockGpsScan } from '../utils/geo'
import { generateOtp } from '../utils/otp'
import {
  IconCheckCircle,
  IconKey,
  IconMapPin,
  IconRefresh,
  IconSend,
} from './Icons'

interface PoDPanelProps {
  delivery: Delivery
  onOtpRequested: (deliveryId: string, otp: string) => void
  onDelivered: (deliveryId: string) => void
  notify: NotifyFn
}

export function PoDPanel({
  delivery,
  onOtpRequested,
  onDelivered,
  notify,
}: PoDPanelProps) {
  const [geofence, setGeofence] = useState<GeofenceResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [otp, setOtp] = useState<OtpVerification>({
    code: '',
    input: '',
    state: 'idle',
    attempts: 0,
  })

  const geofencePassed = geofence?.passed === true
  const otpVerified = otp.state === 'verified'
  const canConfirm = geofencePassed && otpVerified

  const handleScan = () => {
    setScanning(true)
    setGeofence(null)
    window.setTimeout(() => {
      const distance = mockGpsScan(delivery.dropOff.coordinates)
      setGeofence({
        distanceMeters: distance,
        radiusMeters: GEOFENCE_RADIUS_METERS,
        passed: distance <= GEOFENCE_RADIUS_METERS,
        scannedAt: new Date().toISOString(),
      })
      setScanning(false)
    }, 1400)
  }

  const handleRequestOtp = () => {
    const code = generateOtp(6)
    onOtpRequested(delivery.id, code)
    setOtp({
      code,
      input: '',
      state: 'sent',
      attempts: 0,
      sentAt: new Date().toISOString(),
    })
  }

  const handleVerifyOtp = () => {
    if (otp.state !== 'sent') return
    if (otp.input === otp.code) {
      setOtp((current) => ({
        ...current,
        state: 'verified',
        verifiedAt: new Date().toISOString(),
        error: undefined,
      }))
      return
    }
    const attempts = otp.attempts + 1
    if (attempts >= 3) {
      setOtp({
        code: '',
        input: '',
        state: 'idle',
        attempts: 0,
        error: 'Too many failed attempts. Request a fresh code.',
      })
      return
    }
    setOtp((current) => ({
      ...current,
      attempts,
      input: '',
      error: `Incorrect code — ${3 - attempts} attempt${3 - attempts === 1 ? '' : 's'} left.`,
    }))
  }

  const handleConfirm = () => {
    if (!canConfirm) return
    onDelivered(delivery.id)
    notify(`Waybill ${delivery.waybillNumber} confirmed as delivered.`)
  }

  const meterWidth = geofence
    ? Math.min(100, (geofence.distanceMeters / 120) * 100)
    : 0

  return (
    <div className="pod-panel">
      <div className="pod-steps">
        <div className={`pod-step ${geofencePassed ? 'pod-step--done' : ''}`}>
          <div className="pod-step__head">
            <span className="step-num">
              {geofencePassed ? <IconCheckCircle size={13} /> : '1'}
            </span>
            GPS geofence check
          </div>
          <p>
            Scan your current GPS position against the drop-off location. You
            must be within {GEOFENCE_RADIUS_METERS} m.
          </p>
          {geofence ? (
            <>
              <div className="gps-reading">
                {geofence.distanceMeters} m
                <small>
                  / {geofence.radiusMeters} m allowed
                </small>
              </div>
              <div className="gps-meter">
                <span
                  className={`gps-meter__fill ${geofence.passed ? '' : 'gps-meter__fill--fail'}`}
                  style={{ width: `${meterWidth}%` }}
                />
              </div>
              <span
                className={`badge ${geofence.passed ? 'badge--success' : 'badge--danger'}`}
              >
                {geofence.passed ? 'Inside geofence' : 'Outside geofence'}
              </span>
            </>
          ) : (
            <span className="gps-threshold">No reading yet.</span>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={handleScan}
            disabled={scanning}
          >
            <IconMapPin size={15} />
            {scanning
              ? 'Reading GPS…'
              : geofence
                ? 'Scan again'
                : 'Scan GPS position'}
          </button>
        </div>

        <div className={`pod-step ${otpVerified ? 'pod-step--done' : ''}`}>
          <div className="pod-step__head">
            <span className="step-num">
              {otpVerified ? <IconCheckCircle size={13} /> : '2'}
            </span>
            Recipient OTP handshake
          </div>
          <p>
            Send a one-time 6-digit code to the recipient. They must read it
            back to you before confirmation.
          </p>
          {otp.state === 'idle' && (
            <>
              {otp.error && <span className="otp-error">{otp.error}</span>}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={handleRequestOtp}
              >
                <IconSend size={15} />
                Send OTP to {delivery.recipientName.split(' ')[0]}
              </button>
            </>
          )}
          {otp.state === 'sent' && (
            <div className="otp-box">
              <div className="sim-sms">
                <strong>Simulated SMS to {delivery.recipientPhone}</strong>
                Your AZ Delivery verification code is{' '}
                <span className="sim-sms__code">
                  {otp.code.replace(/(\d{3})(\d{3})/, '$1 $2')}
                </span>
                . Show it to your rider to confirm delivery.
              </div>
              <input
                className="input otp-input"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••••"
                aria-label="6-digit recipient code"
                value={otp.input}
                onChange={(event) =>
                  setOtp((current) => ({
                    ...current,
                    input: event.target.value.replace(/\D/g, ''),
                    error: undefined,
                  }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleVerifyOtp()
                }}
              />
              {otp.error && <span className="otp-error">{otp.error}</span>}
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleVerifyOtp}
                disabled={otp.input.length !== 6}
              >
                <IconKey size={15} />
                Verify code
              </button>
            </div>
          )}
          {otpVerified && (
            <span className="badge badge--success">OTP verified</span>
          )}
        </div>

        <div
          className={`pod-step ${canConfirm ? 'pod-step--done pod-step--ready' : ''}`}
        >
          <div className="pod-step__head">
            <span className="step-num">3</span>
            Confirm delivery
          </div>
          <p>
            {canConfirm
              ? 'Both checks passed — safe to hand over the package.'
              : 'Complete the geofence check and OTP verification first.'}
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            <IconCheckCircle size={16} />
            Mark as delivered
          </button>
        </div>
      </div>

      <div className="pod-confirm">
        <span className="pod-confirm__hint">
          <IconRefresh size={13} /> Demo mode: GPS readings and the recipient
          SMS are simulated locally.
        </span>
        <span
          className={`badge ${canConfirm ? 'badge--success' : 'badge--muted'}`}
        >
          {canConfirm ? 'Ready to confirm' : 'Waiting on checks'}
        </span>
      </div>
    </div>
  )
}
