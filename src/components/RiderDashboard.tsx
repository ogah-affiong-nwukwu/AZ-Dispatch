import { useState } from 'react'
import type { BoostItem, Delivery, NotifyFn, User } from '../types'
import type { ThemeMode } from '../utils/storage'
import { formatDateTime, formatEta, formatNgn } from '../utils/format'
import { createTimelineEvent } from '../data/defaults'
import { DashboardFooter } from './DashboardFooter'
import { DashboardHeader } from './DashboardHeader'
import { FlutterwaveModal } from './FlutterwaveModal'
import {
  IconCheckCircle,
  IconClock,
  IconMapPin,
  IconMegaphone,
  IconNavigation,
  IconPackage,
  IconPhone,
  IconPower,
  IconTruck,
  IconZap,
} from './Icons'
import { PoDPanel } from './PoDPanel'
import { StatusBadge } from './StatusBadge'
import './../styles/dashboard.css'
import './../styles/dispatcher.css'
import './../styles/rider.css'

interface RiderDashboardProps {
  user: User
  deliveries: Delivery[]
  boosts: BoostItem[]
  theme: ThemeMode
  onToggleTheme: () => void
  onLogout: () => void
  updateDelivery: (id: string, updater: (d: Delivery) => Delivery) => void
  updateUser: (id: string, updater: (u: User) => User) => void
  activateBoost: (item: BoostItem, reference: string) => void
  notify: NotifyFn
}

const RIDER_SORT: Record<Delivery['status'], number> = {
  out_for_delivery: 0,
  awaiting_otp: 1,
  in_transit: 2,
  assigned: 3,
  delivered: 4,
  approved: 5,
  pending_approval: 6,
}

const VEHICLE_OPTIONS = [
  'Motorcycle',
  'Bicycle',
  'Van',
  'Car',
  'Truck',
] as const

export function RiderDashboard({
  user,
  deliveries,
  boosts,
  theme,
  onToggleTheme,
  onLogout,
  updateDelivery,
  updateUser,
  activateBoost,
  notify,
}: RiderDashboardProps) {
  const profile = user.riderProfile
  const isClockedIn = profile?.clockedIn === true

  const [podOpenId, setPodOpenId] = useState<string | null>(null)
  const [boostTarget, setBoostTarget] = useState<BoostItem | null>(null)
  const [vehicleType, setVehicleType] = useState<string>('Motorcycle')
  const [plateNumber, setPlateNumber] = useState('')
  const [serviceZone, setServiceZone] = useState('')
  const [clockErrors, setClockErrors] = useState<string[]>([])

  const myDeliveries = deliveries
    .filter((delivery) => delivery.assignedRiderId === user.id)
    .slice()
    .sort((a, b) => RIDER_SORT[a.status] - RIDER_SORT[b.status])

  const myBoosts = boosts
    .filter((boost) => boost.ownerId === user.id)
    .slice()
    .sort(
      (a, b) => Number(a.status === 'active') - Number(b.status === 'active'),
    )

  const deliveredCount = myDeliveries.filter(
    (d) => d.status === 'delivered',
  ).length
  const inProgressCount = myDeliveries.filter((d) =>
    ['assigned', 'in_transit', 'out_for_delivery', 'awaiting_otp'].includes(
      d.status,
    ),
  ).length
  const activeBoostCount = myBoosts.filter((b) => b.status === 'active').length

  const handleClockIn = () => {
    const issues: string[] = []
    if (!plateNumber.trim()) {
      issues.push('Enter your vehicle plate or ID number.')
    }
    if (!serviceZone.trim()) {
      issues.push('Enter your service zone.')
    }
    setClockErrors(issues)
    if (issues.length > 0) return

    updateUser(user.id, (current) => ({
      ...current,
      riderProfile: {
        clockedIn: true,
        clockedInAt: new Date().toISOString(),
        vehicleType,
        plateNumber: plateNumber.trim(),
        zone: serviceZone.trim(),
      },
    }))
    notify('You are now available in the business assignment queue.')
  }

  const handleClockOut = () => {
    updateUser(user.id, (current) => ({
      ...current,
      riderProfile: current.riderProfile
        ? { ...current.riderProfile, clockedIn: false }
        : undefined,
    }))
    notify('Clocked out — you are no longer in the dispatch queue.', 'info')
  }

  const handleStartRoute = (delivery: Delivery) => {
    updateDelivery(delivery.id, (current) => ({
      ...current,
      status: 'in_transit',
      timeline: [
        ...current.timeline,
        createTimelineEvent(
          'Route started',
          current.pickup.label,
          `${user.fullName} started the route to ${current.dropOff.label}.`,
        ),
      ],
    }))
    notify(`Route ${delivery.waybillNumber} started.`, 'info')
  }

  const handleArrive = (delivery: Delivery) => {
    updateDelivery(delivery.id, (current) => ({
      ...current,
      status: 'out_for_delivery',
      timeline: [
        ...current.timeline,
        createTimelineEvent(
          'Arrived at drop-off',
          current.dropOff.label,
          'Rider is at the delivery location and starting verification.',
          'warning',
        ),
      ],
    }))
    setPodOpenId(delivery.id)
    notify(`You are at ${delivery.dropOff.label}. Begin verification.`, 'info')
  }

  const handleOtpRequested = (deliveryId: string, code: string) => {
    updateDelivery(deliveryId, (current) => ({
      ...current,
      status: 'awaiting_otp',
      pendingOtp: code,
      otpRequestedAt: new Date().toISOString(),
    }))
  }

  const handleDelivered = (deliveryId: string) => {
    const now = new Date().toISOString()
    updateDelivery(deliveryId, (current) => ({
      ...current,
      status: 'delivered',
      deliveredAt: now,
      pendingOtp: undefined,
      timeline: [
        ...current.timeline,
        createTimelineEvent(
          'Delivered & confirmed',
          current.dropOff.label,
          'GPS geofence passed and recipient OTP verified.',
          'success',
        ),
      ],
    }))
    setPodOpenId(null)
  }

  const openBoostForDelivery = (delivery: Delivery) => {
    setBoostTarget({
      id: `boost-${delivery.id}`,
      kind: 'delivery',
      title: `Priority dispatch for ${delivery.waybillNumber}`,
      description:
        'Push this waybill to the front of the rider queue and lock a dedicated dispatch slot.',
      audience: 'Visible to available riders in your zone',
      budgetNgn: 2000,
      status: 'inactive',
      ownerId: user.id,
      linkedDeliveryId: delivery.id,
      createdAt: new Date().toISOString(),
    })
  }

  const handleBoostSuccess = (item: BoostItem, reference: string) => {
    activateBoost(item, reference)
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
          <h1>Rider portal</h1>
          <p>
            Clock in to join the dispatch queue, then run your assigned
            waybills.
          </p>
        </div>

        <section className="section">
          {isClockedIn ? (
            <div className="availability-panel">
              <span className="availability-panel__icon">
                <IconPower size={20} />
              </span>
              <span className="availability-panel__meta">
                <strong>Available — on shift</strong>
                <span>
                  Clocked in{' '}
                  {profile?.clockedInAt
                    ? formatDateTime(profile.clockedInAt)
                    : ''}
                </span>
                <span className="availability-chips">
                  {profile?.vehicleType && (
                    <span className="chip">
                      <IconTruck size={13} />
                      {profile.vehicleType}
                    </span>
                  )}
                  {profile?.plateNumber && (
                    <span className="chip">{profile.plateNumber}</span>
                  )}
                  {profile?.zone && <span className="chip">{profile.zone}</span>}
                </span>
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={handleClockOut}
              >
                <IconPower size={15} />
                Clock out
              </button>
            </div>
          ) : (
            <div className="card clockin-card">
              <div className="section-head">
                <h2>Clock in for your shift</h2>
                <p>Become available in the business assignment queue</p>
              </div>
              <div className="form-grid form-grid--2">
                <div className="field">
                  <label className="label" htmlFor="rider-vehicle">
                    Vehicle type
                  </label>
                  <select
                    id="rider-vehicle"
                    className="input input--select"
                    value={vehicleType}
                    onChange={(event) => setVehicleType(event.target.value)}
                  >
                    {VEHICLE_OPTIONS.map((option) => (
                      <option value={option} key={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="rider-plate">
                    Vehicle plate / ID number
                  </label>
                  <input
                    id="rider-plate"
                    className="input"
                    placeholder="e.g. KJA 123 QA"
                    value={plateNumber}
                    onChange={(event) => setPlateNumber(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="rider-zone">
                    Service zone
                  </label>
                  <input
                    id="rider-zone"
                    className="input"
                    placeholder="e.g. Ikeja, Surulere"
                    value={serviceZone}
                    onChange={(event) => setServiceZone(event.target.value)}
                  />
                </div>
              </div>
              {clockErrors.length > 0 && (
                <div className="auth__error">{clockErrors.join(' ')}</div>
              )}
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleClockIn}
              >
                <IconPower size={16} />
                Clock in &amp; become available
              </button>
            </div>
          )}
        </section>

        <div className="stats-grid">
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon">
                <IconPackage size={19} />
              </span>
            </span>
            <span className="stat__value">{myDeliveries.length}</span>
            <span className="stat__label">Assigned waybills</span>
          </div>
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon stat__icon--info">
                <IconTruck size={19} />
              </span>
            </span>
            <span className="stat__value">{inProgressCount}</span>
            <span className="stat__label">In progress</span>
          </div>
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon stat__icon--accent">
                <IconCheckCircle size={19} />
              </span>
            </span>
            <span className="stat__value">{deliveredCount}</span>
            <span className="stat__label">Delivered</span>
          </div>
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon stat__icon--warning">
                <IconZap size={19} />
              </span>
            </span>
            <span className="stat__value">{activeBoostCount}</span>
            <span className="stat__label">Active boosts</span>
          </div>
        </div>

        <section className="section">
          <div className="section-head">
            <h2>Assigned waybills</h2>
            <p>Complete geofence + OTP checks before confirming delivery</p>
          </div>

          <div className="waybill-list">
            {myDeliveries.map((delivery) => (
              <div className="card waybill-card" key={delivery.id}>
                <div className="waybill-card__body">
                  <div className="delivery-card__head">
                    <span className="delivery-card__id">
                      <strong>{delivery.waybillNumber}</strong>
                      <span>{delivery.routeLabel}</span>
                    </span>
                    <span className="delivery-card__head-actions">
                      {delivery.boosted && (
                        <span
                          className="chip"
                          title="This delivery was boosted"
                        >
                          <IconZap size={13} />
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
                    <span className="meta-item">
                      <IconClock size={15} />
                      ETA {delivery.eta ? formatEta(delivery.eta) : '—'}
                    </span>
                    <span className="meta-item">
                      <IconPhone size={15} />
                      {delivery.recipientName} · {delivery.recipientPhone}
                    </span>
                    <span className="meta-item">
                      <IconMapPin size={15} />
                      {delivery.dropOff.city}, {delivery.dropOff.state}
                    </span>
                  </div>

                  <div className="delivery-card__actions">
                    {delivery.status === 'assigned' && (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => handleStartRoute(delivery)}
                      >
                        <IconTruck size={15} />
                        Start route
                      </button>
                    )}
                    {delivery.status === 'in_transit' && (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => handleArrive(delivery)}
                      >
                        <IconMapPin size={15} />
                        Arrived at drop-off
                      </button>
                    )}
                    {(delivery.status === 'out_for_delivery' ||
                      delivery.status === 'awaiting_otp') && (
                      <button
                        type="button"
                        className={`btn btn--sm ${podOpenId === delivery.id ? 'btn--ghost' : 'btn--primary'}`}
                        onClick={() =>
                          setPodOpenId((id) =>
                            id === delivery.id ? null : delivery.id,
                          )
                        }
                      >
                        <IconCheckCircle size={15} />
                        {podOpenId === delivery.id
                          ? 'Close verification'
                          : 'Open verification'}
                      </button>
                    )}
                    {delivery.status === 'delivered' && (
                      <span className="meta-item meta-item--delivered">
                        <IconCheckCircle size={15} />
                        Confirmed{' '}
                        {delivery.deliveredAt
                          ? formatDateTime(delivery.deliveredAt)
                          : ''}
                      </span>
                    )}
                    {!delivery.boosted &&
                      delivery.status !== 'delivered' && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => openBoostForDelivery(delivery)}
                        >
                          <IconZap size={15} />
                          Boost delivery
                        </button>
                      )}
                  </div>
                </div>

                {podOpenId === delivery.id &&
                  (delivery.status === 'out_for_delivery' ||
                    delivery.status === 'awaiting_otp') && (
                    <PoDPanel
                      delivery={delivery}
                      onOtpRequested={handleOtpRequested}
                      onDelivered={handleDelivered}
                      notify={notify}
                    />
                  )}
              </div>
            ))}

            {myDeliveries.length === 0 && (
              <div className="card empty-state">
                <IconTruck size={26} />
                <p>
                  No waybills assigned yet — orders pushed by the business will
                  appear here.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Advertise &amp; boost</h2>
            <p>
              Push deliveries to priority dispatch — pay via Flutterwave
            </p>
          </div>

          <div className="boost-grid">
            {myBoosts.map((boost) => (
              <div
                className={`card boost-card ${boost.status === 'active' ? 'boost-card--active' : ''}`}
                key={boost.id}
              >
                <div className="boost-card__head">
                  <span className="boost-card__icon">
                    <IconTruck size={20} />
                  </span>
                  <span className="boost-card__chips">
                    <span
                      className={`badge ${boost.status === 'active' ? 'badge--success' : 'badge--muted'}`}
                    >
                      {boost.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                    <span className="badge badge--info">Delivery boost</span>
                  </span>
                </div>
                <h3>{boost.title}</h3>
                <p className="boost-card__desc">{boost.description}</p>
                <div className="boost-card__meta">
                  <span className="boost-card__price">
                    {formatNgn(boost.budgetNgn)}
                    <small> / campaign</small>
                  </span>
                  {boost.status === 'active' ? (
                    <span className="chip">
                      <IconCheckCircle size={13} />
                      Live
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={() => setBoostTarget(boost)}
                    >
                      <IconMegaphone size={15} />
                      Advertise / Boost order
                    </button>
                  )}
                </div>
              </div>
            ))}

            {myBoosts.length === 0 && (
              <div className="card empty-state">
                <IconMegaphone size={26} />
                <p>
                  Boost one of your deliveries from its waybill card to create
                  a campaign.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      <DashboardFooter />

      {boostTarget && (
        <FlutterwaveModal
          item={boostTarget}
          payerName={user.fullName}
          payerEmail={user.email}
          onClose={() => setBoostTarget(null)}
          onSuccess={(reference) => handleBoostSuccess(boostTarget, reference)}
        />
      )}
    </div>
  )
}
