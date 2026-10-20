import { useEffect, useState } from 'react'
import type { Address, BusinessProfile, User } from '../types'
import { AZ_HUB } from '../data/defaults'
import { mockGeocode } from '../utils/geo'
import { placeRiderOrder, requestRiderForOrder } from '../services/orders'
import { fetchCustomerProfile, saveCustomerProfile } from '../services/auth'
import { IconAlertTriangle, IconNavigation, IconSend } from './Icons'
import './../styles/customer.css'
import './../styles/flow.css'

interface RiderRequestSectionProps {
  user: User
  linkedOrderId?: string | null
  linkedBusiness?: BusinessProfile | null
  onPlaced: () => void
  onCancelLinked?: () => void
  notify: (text: string, tone?: 'success' | 'error' | 'info') => void
}

interface AddressForm {
  label: string
  line1: string
  city: string
  state: string
}

const EMPTY_ADDRESS: AddressForm = {
  label: '',
  line1: '',
  city: '',
  state: '',
}

export function RiderRequestSection({
  user,
  linkedOrderId = null,
  linkedBusiness = null,
  onPlaced,
  onCancelLinked,
  notify,
}: RiderRequestSectionProps) {
  const [pickup, setPickup] = useState<AddressForm>(
    linkedOrderId ? EMPTY_ADDRESS : { ...AZ_HUB },
  )
  const [pickupPhone, setPickupPhone] = useState('')
  const [dropOff, setDropOff] = useState<AddressForm>(EMPTY_ADDRESS)
  const [deliveryPhone, setDeliveryPhone] = useState('')
  const [itemDescription, setItemDescription] = useState('')
  const [feeNgn, setFeeNgn] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (linkedOrderId && linkedBusiness) {
      setPickup({
        label: linkedBusiness.businessName,
        line1: linkedBusiness.businessAddress ?? '',
        city: '',
        state: '',
      })
      setPickupPhone(linkedBusiness.businessPhone ?? '')
    }
  }, [linkedOrderId, linkedBusiness])

  useEffect(() => {
    let active = true
    fetchCustomerProfile(user.id)
      .then((profile) => {
        if (!active || !profile) return
        setDeliveryPhone((current) => profile.phone ?? current)
        if (profile.defaultAddress) {
          setDropOff({
            label: profile.defaultAddress.label,
            line1: profile.defaultAddress.line1,
            city: profile.defaultAddress.city,
            state: profile.defaultAddress.state,
          })
        }
      })
      .catch(() => {
        if (!active) return
        console.warn('[rider-request] could not load the customer profile')
      })
    return () => {
      active = false
    }
  }, [user.id])

  const setPickupField = (key: keyof AddressForm, value: string) => {
    setPickup((current) => ({ ...current, [key]: value }))
  }

  const setDropOffField = (key: keyof AddressForm, value: string) => {
    setDropOff((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async () => {
    const issues: string[] = []
    if (!pickup.line1.trim()) issues.push('Pickup street address is required.')
    if (!pickupPhone.trim()) issues.push('Pickup phone is required.')
    if (!dropOff.line1.trim()) issues.push('Enter your drop-off house address.')
    if (!deliveryPhone.trim()) issues.push('Delivery phone is required.')
    if (!itemDescription.trim()) {
      issues.push('Describe the item you are sending.')
    }
    if (!linkedOrderId) {
      const fee = Number(feeNgn)
      if (!Number.isFinite(fee) || fee <= 0) {
        issues.push('Enter a valid delivery fee.')
      }
    }
    setErrors(issues)
    if (issues.length > 0) return

    const pickupAddress: Address = {
      label: pickup.label.trim() || 'Pickup',
      line1: pickup.line1.trim(),
      city: pickup.city.trim(),
      state: pickup.state.trim(),
      coordinates: mockGeocode(
        `${pickup.line1} ${pickup.city}`,
        AZ_HUB.coordinates,
      ),
    }
    const dropOffAddress: Address = {
      label: dropOff.label.trim() || 'Drop-off',
      line1: dropOff.line1.trim(),
      city: dropOff.city.trim(),
      state: dropOff.state.trim(),
      coordinates: mockGeocode(
        `${dropOff.line1} ${dropOff.city}`,
        AZ_HUB.coordinates,
      ),
    }

    await saveCustomerProfile(user.id, {
      phone: deliveryPhone.trim(),
      defaultAddress: dropOffAddress,
    })

    setSubmitting(true)
    const error = linkedOrderId
      ? await requestRiderForOrder({
          orderId: linkedOrderId,
          pickup: pickupAddress,
          pickupPhone: pickupPhone.trim(),
          dropOff: dropOffAddress,
          deliveryPhone: deliveryPhone.trim(),
          itemDescription,
        })
      : (
          await placeRiderOrder({
            pickup: pickupAddress,
            pickupPhone: pickupPhone.trim(),
            dropOff: dropOffAddress,
            deliveryPhone: deliveryPhone.trim(),
            itemDescription,
            deliveryFee: Math.floor(Number(feeNgn)),
            recipientName: user.fullName,
          })
        ).error ?? null
    setSubmitting(false)
    if (error) {
      setErrors([error])
      return
    }
    setItemDescription('')
    setFeeNgn('')
    setErrors([])
    notify(
      linkedOrderId
        ? 'Rider requested for your order.'
        : 'Dispatch request placed — a rider will pick it up soon.',
    )
    onPlaced()
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>{linkedOrderId ? 'Order a rider for this order' : 'Request a dispatch rider'}</h2>
        <p>
          {linkedOrderId
            ? 'The rider will pick up from the business and deliver to you'
            : 'Delivery-only — no products needed'}
        </p>
      </div>

      <div className="card order-form-card">
        <div className="banner banner--warning">
          <IconAlertTriangle size={20} className="banner__icon" />
          <div className="banner__body">
            <strong>NOTICE TO CUSTOMERS</strong>
            <p>
              Please make payments ONLY to the official AZ company account and
              place orders directly through the platform. Do not make private
              transfers to individual dispatch riders.
            </p>
          </div>
        </div>

        <div className="form-grid form-grid--2">
          <div className="field field--full">
            <span className="label">
              <IconNavigation size={14} /> Pickup address
            </span>
          </div>
          <div className="field">
            <label className="label" htmlFor="rider-req-pickup-line1">
              Street address
            </label>
            <input
              id="rider-req-pickup-line1"
              className="input"
              placeholder="House number and street"
              value={pickup.line1}
              onChange={(event) => setPickupField('line1', event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="rider-req-pickup-city">
              City
            </label>
            <input
              id="rider-req-pickup-city"
              className="input"
              placeholder="City"
              value={pickup.city}
              onChange={(event) => setPickupField('city', event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="rider-req-pickup-phone">
              Pickup phone
            </label>
            <input
              id="rider-req-pickup-phone"
              className="input"
              inputMode="tel"
              placeholder="+234 800 000 0000"
              value={pickupPhone}
              onChange={(event) => setPickupPhone(event.target.value)}
            />
          </div>

          <div className="field field--full">
            <span className="label">
              <IconNavigation size={14} /> Delivery address
            </span>
          </div>
          <div className="field">
            <label className="label" htmlFor="rider-req-drop-line1">
              House address
            </label>
            <input
              id="rider-req-drop-line1"
              className="input"
              placeholder="House number and street"
              value={dropOff.line1}
              onChange={(event) => setDropOffField('line1', event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="rider-req-drop-city">
              City
            </label>
            <input
              id="rider-req-drop-city"
              className="input"
              placeholder="City"
              value={dropOff.city}
              onChange={(event) => setDropOffField('city', event.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="rider-req-delivery-phone">
              Delivery phone
            </label>
            <input
              id="rider-req-delivery-phone"
              className="input"
              inputMode="tel"
              placeholder="+234 800 000 0000"
              value={deliveryPhone}
              onChange={(event) => setDeliveryPhone(event.target.value)}
            />
          </div>

          {!linkedOrderId && (
            <div className="field">
              <label className="label" htmlFor="rider-req-fee">
                Delivery fee (₦)
              </label>
              <input
                id="rider-req-fee"
                className="input"
                inputMode="numeric"
                placeholder="e.g. 2000"
                value={feeNgn}
                onChange={(event) =>
                  setFeeNgn(event.target.value.replace(/[^\d.]/g, ''))
                }
              />
            </div>
          )}

          <div className="field field--full">
            <label className="label" htmlFor="rider-req-item">
              Item description
            </label>
            <textarea
              id="rider-req-item"
              className="input input--textarea"
              rows={3}
              placeholder="What are you sending? e.g. Laptop in padded box, 2.5 kg"
              value={itemDescription}
              onChange={(event) => setItemDescription(event.target.value)}
            />
          </div>
        </div>

        {errors.length > 0 && (
          <div className="auth__error">{errors.join(' ')}</div>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={submitting}
            onClick={handleSubmit}
          >
            <IconSend size={16} />
            {submitting
              ? 'Submitting…'
              : linkedOrderId
                ? 'Request rider for this order'
                : 'Request dispatch rider'}
          </button>
          {linkedOrderId && onCancelLinked && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onCancelLinked}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
