import { useState } from 'react'
import type { Delivery, NewOrderInput, User } from '../types'
import type { ThemeMode } from '../utils/storage'
import { formatDateTime, formatEta } from '../utils/format'
import { mockGeocode } from '../utils/geo'
import {
  DEFAULT_PICKUP,
  createTimelineEvent,
  createWaybillNumber,
} from '../data/defaults'
import { DashboardFooter } from './DashboardFooter'
import { DashboardHeader } from './DashboardHeader'
import {
  IconAlertTriangle,
  IconCheckCircle,
  IconChevronDown,
  IconClock,
  IconHome,
  IconKey,
  IconMapPin,
  IconNavigation,
  IconPackage,
  IconPhone,
  IconSend,
  IconTruck,
} from './Icons'
import { StatusBadge } from './StatusBadge'
import './../styles/dashboard.css'
import './../styles/customer.css'

interface CustomerDashboardProps {
  user: User
  deliveries: Delivery[]
  theme: ThemeMode
  onToggleTheme: () => void
  onLogout: () => void
  addDelivery: (delivery: Delivery) => void
  updateDelivery: (id: string, updater: (d: Delivery) => Delivery) => void
  updateUser: (id: string, updater: (u: User) => User) => void
  notify: (text: string, tone?: 'success' | 'error' | 'info') => void
}

interface AddressForm {
  label: string
  line1: string
  city: string
  state: string
}

const EMPTY_ORDER: NewOrderInput = {
  itemDescription: '',
  amountNgn: '',
  label: '',
  line1: '',
  city: '',
  state: '',
}

const STATUS_ORDER: Record<Delivery['status'], number> = {
  awaiting_otp: 0,
  out_for_delivery: 1,
  in_transit: 2,
  assigned: 3,
  approved: 4,
  pending_approval: 5,
  delivered: 6,
}

export function CustomerDashboard({
  user,
  deliveries,
  theme,
  onToggleTheme,
  onLogout,
  addDelivery,
  updateDelivery,
  updateUser,
  notify,
}: CustomerDashboardProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingDropOffId, setEditingDropOffId] = useState<string | null>(null)
  const [editingDefaultAddress, setEditingDefaultAddress] = useState(false)
  const [showPreviousOrders, setShowPreviousOrders] = useState(false)
  const [orderForm, setOrderForm] = useState<NewOrderInput>(EMPTY_ORDER)
  const [orderErrors, setOrderErrors] = useState<string[]>([])
  const [dropOffForm, setDropOffForm] = useState<AddressForm>({
    label: '',
    line1: '',
    city: '',
    state: '',
  })
  const [addressForm, setAddressForm] = useState<AddressForm>({
    label: '',
    line1: '',
    city: '',
    state: '',
  })
  const [formErrors, setFormErrors] = useState<string[]>([])

  const myDeliveries = deliveries
    .filter((delivery) => {
      if (delivery.customerEmail) {
        return (
          delivery.customerEmail.toLowerCase() === user.email.toLowerCase()
        )
      }
      return delivery.customerId === user.id
    })
    .slice()
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

  const active = myDeliveries.filter((d) => d.status !== 'delivered')
  const inReview = myDeliveries.filter((d) =>
    ['pending_approval', 'approved'].includes(d.status),
  )
  const inMotion = myDeliveries.filter((d) =>
    ['in_transit', 'out_for_delivery', 'awaiting_otp'].includes(d.status),
  )
  const delivered = myDeliveries.filter((d) => d.status === 'delivered')
  const awaitingOtp = myDeliveries.filter((d) => d.status === 'awaiting_otp')

  const handleSubmitOrder = () => {
    const issues: string[] = []
    if (!orderForm.itemDescription.trim()) {
      issues.push('Describe the item you are sending.')
    }
    if (!orderForm.label.trim()) issues.push('Give the drop-off a label.')
    if (!orderForm.line1.trim()) issues.push('Street address is required.')
    if (!orderForm.city.trim()) issues.push('City is required.')
    if (!orderForm.state.trim()) issues.push('State is required.')
    const amount = Number(orderForm.amountNgn)
    if (
      orderForm.amountNgn.trim() !== '' &&
      (!Number.isFinite(amount) || amount <= 0)
    ) {
      issues.push('Enter a valid order amount.')
    }
    setOrderErrors(issues)
    if (issues.length > 0) return

    const now = new Date().toISOString()
    const waybillNumber = createWaybillNumber()
    const coordinates = mockGeocode(
      `${orderForm.label} ${orderForm.line1} ${orderForm.city}`,
      user.defaultAddress?.coordinates ?? DEFAULT_PICKUP.coordinates,
    )

    addDelivery({
      id: `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      waybillNumber,
      customerId: user.id,
      customerEmail: user.email,
      customerName: user.fullName,
      recipientName: user.fullName,
      recipientPhone: user.phone,
      itemDescription: orderForm.itemDescription.trim(),
      amountNgn: amount > 0 ? amount : undefined,
      pickup: DEFAULT_PICKUP,
      dropOff: {
        label: orderForm.label.trim(),
        line1: orderForm.line1.trim(),
        city: orderForm.city.trim(),
        state: orderForm.state.trim(),
        coordinates,
      },
      status: 'pending_approval',
      routeLabel: `${DEFAULT_PICKUP.city} → ${orderForm.city.trim()}`,
      boosted: false,
      createdAt: now,
      timeline: [
        createTimelineEvent(
          'Order submitted',
          'Customer app',
          'Awaiting business approval and dispatch assignment.',
        ),
      ],
    })

    setOrderForm(EMPTY_ORDER)
    notify(
      `Order ${waybillNumber} submitted — pending business approval.`,
      'info',
    )
  }

  const beginDropOffEdit = (delivery: Delivery) => {
    setEditingDropOffId(delivery.id)
    setDropOffForm({
      label: delivery.dropOff.label,
      line1: delivery.dropOff.line1,
      city: delivery.dropOff.city,
      state: delivery.dropOff.state,
    })
    setFormErrors([])
  }

  const beginAddressEdit = () => {
    const address = user.defaultAddress
    setAddressForm({
      label: address?.label ?? 'Home',
      line1: address?.line1 ?? '',
      city: address?.city ?? '',
      state: address?.state ?? '',
    })
    setEditingDefaultAddress(true)
    setFormErrors([])
  }

  const validateAddress = (form: AddressForm): string[] => {
    const issues: string[] = []
    if (!form.label.trim()) issues.push('Give this location a label.')
    if (!form.line1.trim()) issues.push('Street address is required.')
    if (!form.city.trim()) issues.push('City is required.')
    if (!form.state.trim()) issues.push('State is required.')
    return issues
  }

  const saveDropOff = () => {
    const issues = validateAddress(dropOffForm)
    setFormErrors(issues)
    if (issues.length > 0 || !editingDropOffId) return
    const delivery = deliveries.find((d) => d.id === editingDropOffId)
    if (!delivery) return
    const coordinates = mockGeocode(
      `${dropOffForm.label} ${dropOffForm.line1} ${dropOffForm.city}`,
      delivery.dropOff.coordinates,
    )
    updateDelivery(delivery.id, (current) => ({
      ...current,
      dropOff: {
        label: dropOffForm.label.trim(),
        line1: dropOffForm.line1.trim(),
        city: dropOffForm.city.trim(),
        state: dropOffForm.state.trim(),
        coordinates,
      },
    }))
    setEditingDropOffId(null)
    notify(`Drop-off location for ${delivery.waybillNumber} updated.`)
  }

  const saveDefaultAddress = () => {
    const issues = validateAddress(addressForm)
    setFormErrors(issues)
    if (issues.length > 0) return
    const coordinates = mockGeocode(
      `${addressForm.label} ${addressForm.line1} ${addressForm.city}`,
      user.defaultAddress?.coordinates ?? DEFAULT_PICKUP.coordinates,
    )
    updateUser(user.id, (current) => ({
      ...current,
      defaultAddress: {
        label: addressForm.label.trim(),
        line1: addressForm.line1.trim(),
        city: addressForm.city.trim(),
        state: addressForm.state.trim(),
        coordinates,
      },
    }))
    setEditingDefaultAddress(false)
    notify('Default address saved.')
  }

  const renderMeta = (delivery: Delivery) => {
    if (delivery.status === 'pending_approval') {
      return (
        <span className="meta-item meta-item--pending">
          <IconClock size={15} />
          Awaiting business approval
        </span>
      )
    }
    if (delivery.status === 'approved') {
      return (
        <span className="meta-item meta-item--pending">
          <IconClock size={15} />
          Awaiting dispatch assignment
        </span>
      )
    }
    return (
      <>
        <span className="meta-item">
          <IconClock size={15} />
          ETA {delivery.eta ? formatEta(delivery.eta) : '—'}
        </span>
        <span className="meta-item">
          <IconTruck size={15} />
          Rider: {delivery.riderName ?? '—'}
        </span>
      </>
    )
  }

  return (
    <div className="dashboard">
      <DashboardHeader
        user={user}
        theme={theme}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
      />

      <main className="dash-main container">
        <div className="page-head">
          <h1>Welcome back, {user.fullName.split(' ')[0]}</h1>
          <p>Place a new order or follow your deliveries here.</p>
        </div>

        {awaitingOtp.map((delivery) => (
          <div className="banner banner--success" key={delivery.id}>
            <IconKey size={20} className="banner__icon" />
            <div className="banner__body">
              <strong>
                Rider is at your door for waybill {delivery.waybillNumber}
              </strong>
              <p>
                Share this one-time code with {delivery.riderName} to confirm
                your delivery:
              </p>
              <span className="otp-code">
                {delivery.pendingOtp
                  ? delivery.pendingOtp.replace(/(\d{3})(\d{3})/, '$1 $2')
                  : '——'}
              </span>
            </div>
          </div>
        ))}

        <section className="section">
          <div className="section-head">
            <h2>Place a new order</h2>
            <p>Submits live into the business review queue</p>
          </div>

          <div className="card order-form-card">
            <div className="banner banner--warning">
              <IconAlertTriangle size={20} className="banner__icon" />
              <div className="banner__body">
                <strong>NOTICE TO CUSTOMERS</strong>
                <p>
                  Please make payments ONLY to the official AZ company account
                  and place orders directly through the platform. Do not make
                  private transfers to individual dispatch riders.
                </p>
              </div>
            </div>

            <div className="form-grid form-grid--2">
              <div className="field field--full">
                <label className="label" htmlFor="order-item">
                  Item description
                </label>
                <textarea
                  id="order-item"
                  className="input input--textarea"
                  rows={3}
                  placeholder="What are you sending? e.g. Laptop in padded box, 2.5 kg"
                  value={orderForm.itemDescription}
                  onChange={(event) =>
                    setOrderForm((form) => ({
                      ...form,
                      itemDescription: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="order-amount">
                  Order amount (₦)
                </label>
                <input
                  id="order-amount"
                  className="input"
                  inputMode="numeric"
                  placeholder="e.g. 25000"
                  value={orderForm.amountNgn}
                  onChange={(event) =>
                    setOrderForm((form) => ({
                      ...form,
                      amountNgn: event.target.value.replace(/[^\d.]/g, ''),
                    }))
                  }
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="order-label">
                  Drop-off label
                </label>
                <input
                  id="order-label"
                  className="input"
                  placeholder="e.g. Home, Work"
                  value={orderForm.label}
                  onChange={(event) =>
                    setOrderForm((form) => ({
                      ...form,
                      label: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="order-line1">
                  Street address
                </label>
                <input
                  id="order-line1"
                  className="input"
                  placeholder="House number and street"
                  value={orderForm.line1}
                  onChange={(event) =>
                    setOrderForm((form) => ({
                      ...form,
                      line1: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="order-city">
                  City
                </label>
                <input
                  id="order-city"
                  className="input"
                  placeholder="City"
                  value={orderForm.city}
                  onChange={(event) =>
                    setOrderForm((form) => ({
                      ...form,
                      city: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="order-state">
                  State
                </label>
                <input
                  id="order-state"
                  className="input"
                  placeholder="State"
                  value={orderForm.state}
                  onChange={(event) =>
                    setOrderForm((form) => ({
                      ...form,
                      state: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {orderErrors.length > 0 && (
              <div className="auth__error">{orderErrors.join(' ')}</div>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSubmitOrder}
              >
                <IconSend size={16} />
                Submit order for approval
              </button>
            </div>
          </div>
        </section>

        <div className="stats-grid">
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon">
                <IconPackage size={19} />
              </span>
            </span>
            <span className="stat__value">{active.length}</span>
            <span className="stat__label">Active deliveries</span>
          </div>
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon stat__icon--warning">
                <IconClock size={19} />
              </span>
            </span>
            <span className="stat__value">{inReview.length}</span>
            <span className="stat__label">In review</span>
          </div>
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon stat__icon--info">
                <IconTruck size={19} />
              </span>
            </span>
            <span className="stat__value">{inMotion.length}</span>
            <span className="stat__label">On the move</span>
          </div>
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon stat__icon--accent">
                <IconCheckCircle size={19} />
              </span>
            </span>
            <span className="stat__value">{delivered.length}</span>
            <span className="stat__label">Delivered</span>
          </div>
        </div>

        <section className="section">
          <div className="section-head">
            <h2>Active deliveries</h2>
            <p>{active.length} waybills in progress</p>
          </div>

          <div className="delivery-list">
            {active.map((delivery) => (
              <div className="card delivery-card" key={delivery.id}>
                <div className="delivery-card__body">
                  <div className="delivery-card__head">
                    <span className="delivery-card__id">
                      <strong>{delivery.waybillNumber}</strong>
                      <span>{delivery.routeLabel}</span>
                    </span>
                    <span className="delivery-card__head-actions">
                      {delivery.boosted && (
                        <span className="chip" title="This delivery was boosted">
                          <IconNavigation size={13} />
                          Boosted
                        </span>
                      )}
                      <StatusBadge status={delivery.status} />
                    </span>
                  </div>

                  <p className="delivery-card__item">
                    <IconPackage size={14} />
                    {delivery.itemDescription}
                  </p>

                  <div className="route">
                    <div className="route__stop">
                      <small>Pickup</small>
                      <strong>{delivery.pickup.label}</strong>
                      <span>{delivery.pickup.line1}</span>
                    </div>
                    <span className="route__arrow">
                      <IconNavigation size={17} />
                    </span>
                    <div className="route__stop">
                      <small>Drop-off</small>
                      <strong>{delivery.dropOff.label}</strong>
                      <span>{delivery.dropOff.line1}</span>
                    </div>
                  </div>

                  <div className="delivery-card__meta">
                    {renderMeta(delivery)}
                    <span className="meta-item">
                      <IconPhone size={15} />
                      {delivery.recipientPhone}
                    </span>
                  </div>

                  <div className="delivery-card__actions">
                    {delivery.status !== 'awaiting_otp' &&
                      delivery.status !== 'delivered' && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => beginDropOffEdit(delivery)}
                        >
                          <IconMapPin size={15} />
                          Change drop-off location
                        </button>
                      )}
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        setExpandedId((id) =>
                          id === delivery.id ? null : delivery.id,
                        )
                      }
                    >
                      <IconChevronDown
                        size={15}
                        className={
                          expandedId === delivery.id ? 'chevron-flip' : ''
                        }
                      />
                      Tracking details
                    </button>
                  </div>
                </div>

                {editingDropOffId === delivery.id && (
                  <div className="dropoff-form">
                    <div className="form-grid form-grid--2">
                      <div className="field">
                        <label className="label" htmlFor="drop-label">
                          Location label
                        </label>
                        <input
                          id="drop-label"
                          className="input"
                          placeholder="e.g. Work, Aunt's place"
                          value={dropOffForm.label}
                          onChange={(event) =>
                            setDropOffForm((form) => ({
                              ...form,
                              label: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="drop-line1">
                          Street address
                        </label>
                        <input
                          id="drop-line1"
                          className="input"
                          placeholder="House number and street"
                          value={dropOffForm.line1}
                          onChange={(event) =>
                            setDropOffForm((form) => ({
                              ...form,
                              line1: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="drop-city">
                          City
                        </label>
                        <input
                          id="drop-city"
                          className="input"
                          placeholder="City"
                          value={dropOffForm.city}
                          onChange={(event) =>
                            setDropOffForm((form) => ({
                              ...form,
                              city: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className="field">
                        <label className="label" htmlFor="drop-state">
                          State
                        </label>
                        <input
                          id="drop-state"
                          className="input"
                          placeholder="State"
                          value={dropOffForm.state}
                          onChange={(event) =>
                            setDropOffForm((form) => ({
                              ...form,
                              state: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </div>
                    {formErrors.length > 0 && (
                      <div className="auth__error">{formErrors.join(' ')}</div>
                    )}
                    <div className="form-actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={saveDropOff}
                      >
                        Save new drop-off
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setEditingDropOffId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {expandedId === delivery.id && (
                  <div className="timeline">
                    {delivery.timeline.map((item) => (
                      <div
                        className={`timeline__item timeline__item--${item.tone}`}
                        key={item.id}
                      >
                        <span className="timeline__dot" />
                        <div className="timeline__title">
                          {item.title}
                          <span className="timeline__time">
                            {' '}
                            · {formatDateTime(item.timestamp)}
                          </span>
                        </div>
                        <div className="timeline__desc">
                          {item.location} — {item.description}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="timeline-toggle"
                  onClick={() =>
                    setExpandedId((id) =>
                      id === delivery.id ? null : delivery.id,
                    )
                  }
                >
                  <IconChevronDown
                    size={16}
                    className={expandedId === delivery.id ? 'chevron-flip' : ''}
                  />
                  {expandedId === delivery.id
                    ? 'Hide tracking'
                    : 'Show tracking'}
                </button>
              </div>
            ))}

            {active.length === 0 && (
              <div className="card empty-state">
                <IconPackage size={26} />
                <p>No active deliveries yet — place your first order above.</p>
              </div>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Default delivery address</h2>
            <p>Used as the drop-off for new waybills</p>
          </div>

          <div className="card address-card">
            <span className="address-card__icon">
              <IconHome size={20} />
            </span>
            {editingDefaultAddress ? (
              <div className="address-card__body">
                <div className="form-grid form-grid--2">
                  <div className="field">
                    <label className="label" htmlFor="addr-label">
                      Label
                    </label>
                    <input
                      id="addr-label"
                      className="input"
                      placeholder="Home"
                      value={addressForm.label}
                      onChange={(event) =>
                        setAddressForm((form) => ({
                          ...form,
                          label: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="addr-line1">
                      Street address
                    </label>
                    <input
                      id="addr-line1"
                      className="input"
                      placeholder="House number and street"
                      value={addressForm.line1}
                      onChange={(event) =>
                        setAddressForm((form) => ({
                          ...form,
                          line1: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="addr-city">
                      City
                    </label>
                    <input
                      id="addr-city"
                      className="input"
                      placeholder="City"
                      value={addressForm.city}
                      onChange={(event) =>
                        setAddressForm((form) => ({
                          ...form,
                          city: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="addr-state">
                      State
                    </label>
                    <input
                      id="addr-state"
                      className="input"
                      placeholder="State"
                      value={addressForm.state}
                      onChange={(event) =>
                        setAddressForm((form) => ({
                          ...form,
                          state: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                {formErrors.length > 0 && (
                  <div className="auth__error">{formErrors.join(' ')}</div>
                )}
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={saveDefaultAddress}
                  >
                    Save address
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setEditingDefaultAddress(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="address-card__body">
                  <div className="address-card__head">
                    <h3>{user.defaultAddress?.label ?? 'Home'}</h3>
                    <span className="chip">Default</span>
                  </div>
                  <p>
                    {user.defaultAddress?.line1},{' '}
                    {user.defaultAddress?.city},{' '}
                    {user.defaultAddress?.state}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={beginAddressEdit}
                >
                  Edit
                </button>
              </>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Previous orders</h2>
            <p>{delivered.length} completed waybills</p>
          </div>

          <button
            type="button"
            className="history-toggle"
            onClick={() => setShowPreviousOrders((value) => !value)}
            aria-expanded={showPreviousOrders}
          >
            <IconChevronDown
              size={16}
              className={showPreviousOrders ? 'chevron-flip' : ''}
            />
            {showPreviousOrders
              ? 'Hide previous orders'
              : `Show previous orders (${delivered.length})`}
          </button>

          {showPreviousOrders && (
            <div className="delivery-list">
              {delivered.map((delivery) => (
                <div className="card delivery-card" key={delivery.id}>
                  <div className="delivery-card__body">
                    <div className="delivery-card__head">
                      <span className="delivery-card__id">
                        <strong>{delivery.waybillNumber}</strong>
                        <span>{delivery.routeLabel}</span>
                      </span>
                      <StatusBadge status={delivery.status} />
                    </div>
                    <div className="delivery-card__meta">
                      <span className="meta-item">
                        <IconCheckCircle size={15} />
                        Delivered{' '}
                        {delivery.deliveredAt
                          ? formatDateTime(delivery.deliveredAt)
                          : ''}
                      </span>
                      <span className="meta-item">
                        <IconMapPin size={15} />
                        {delivery.dropOff.label} · {delivery.dropOff.city}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              {delivered.length === 0 && (
                <div className="card empty-state">
                  <IconCheckCircle size={26} />
                  <p>
                    No completed orders yet — delivered waybills will appear
                    here.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <DashboardFooter />
    </div>
  )
}
