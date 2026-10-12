import { useState } from 'react'
import type { BoostItem, Delivery, NotifyFn, User } from '../types'
import type { ThemeMode } from '../utils/storage'
import { formatDateTime, formatNgn, isSameLocalDay } from '../utils/format'
import { createTimelineEvent } from '../data/defaults'
import { DashboardFooter } from './DashboardFooter'
import { DashboardHeader } from './DashboardHeader'
import { FlutterwaveModal } from './FlutterwaveModal'
import {
  IconBuilding,
  IconCalendar,
  IconCheckCircle,
  IconChevronDown,
  IconClock,
  IconMegaphone,
  IconNavigation,
  IconPackage,
  IconPhone,
  IconSearch,
  IconTruck,
  IconUsers,
  IconX,
} from './Icons'
import { StatusBadge } from './StatusBadge'
import './../styles/dashboard.css'
import './../styles/dispatcher.css'

interface BusinessDashboardProps {
  user: User
  deliveries: Delivery[]
  boosts: BoostItem[]
  riders: User[]
  theme: ThemeMode
  onToggleTheme: () => void
  onLogout: () => void
  updateDelivery: (id: string, updater: (d: Delivery) => Delivery) => void
  activateBoost: (item: BoostItem, reference: string) => void
  notify: NotifyFn
}

function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function BusinessDashboard({
  user,
  deliveries,
  boosts,
  riders,
  theme,
  onToggleTheme,
  onLogout,
  updateDelivery,
  activateBoost,
  notify,
}: BusinessDashboardProps) {
  const [boostTarget, setBoostTarget] = useState<BoostItem | null>(null)
  const [assignments, setAssignments] = useState<Record<string, string>>({})
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyDate, setHistoryDate] = useState('')
  const [historyQuery, setHistoryQuery] = useState('')
  const [today] = useState(() => new Date())

  const todayDeliveries = deliveries.filter((delivery) =>
    isSameLocalDay(delivery.createdAt, today),
  )

  const incomingOrders = todayDeliveries
    .filter(
      (delivery) =>
        delivery.status === 'pending_approval' ||
        delivery.status === 'approved',
    )
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const pipeline = todayDeliveries
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const myBoosts = boosts
    .filter((boost) => boost.ownerId === user.id)
    .slice()
    .sort(
      (a, b) => Number(a.status === 'active') - Number(b.status === 'active'),
    )

  const pendingReviewCount = todayDeliveries.filter(
    (d) => d.status === 'pending_approval',
  ).length
  const awaitingDispatchCount = todayDeliveries.filter(
    (d) => d.status === 'approved',
  ).length
  const inFieldCount = todayDeliveries.filter((d) =>
    ['assigned', 'in_transit', 'out_for_delivery', 'awaiting_otp'].includes(
      d.status,
    ),
  ).length
  const businessDeliveredCount = todayDeliveries.filter(
    (d) => d.status === 'delivered',
  ).length

  const query = historyQuery.trim().toLowerCase()
  const hasHistoryFilters = historyDate !== '' || query !== ''
  const historyResults = hasHistoryFilters
    ? deliveries
        .filter((delivery) => {
          if (historyDate) {
            const picked = new Date(`${historyDate}T00:00:00`)
            if (!isSameLocalDay(delivery.createdAt, picked)) return false
          }
          if (query) {
            const matchesId =
              delivery.id.toLowerCase().includes(query) ||
              delivery.waybillNumber.toLowerCase().includes(query)
            if (!matchesId) return false
          }
          return true
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : []

  const handleApprove = (delivery: Delivery) => {
    updateDelivery(delivery.id, (current) => ({
      ...current,
      status: 'approved',
      timeline: [
        ...current.timeline,
        createTimelineEvent(
          'Order approved',
          'Business dashboard',
          `${user.businessName ?? 'Business'} approved the order — awaiting dispatch assignment.`,
        ),
      ],
    }))
    notify(`Order ${delivery.waybillNumber} approved.`, 'info')
  }

  const handleAssign = (delivery: Delivery) => {
    const riderId = assignments[delivery.id]
    const rider = riders.find((candidate) => candidate.id === riderId)
    if (!rider) {
      notify('Select an available rider before assigning.', 'error')
      return
    }
    const eta = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
    updateDelivery(delivery.id, (current) => ({
      ...current,
      status: 'assigned',
      assignedRiderId: rider.id,
      riderName: rider.fullName,
      eta,
      timeline: [
        ...current.timeline,
        createTimelineEvent(
          'Rider assigned',
          'Business dashboard',
          `${rider.fullName} has been assigned to this waybill.`,
        ),
      ],
    }))
    setAssignments((current) => {
      const next = { ...current }
      delete next[delivery.id]
      return next
    })
    notify(
      `${delivery.waybillNumber} assigned to ${rider.fullName} and pushed to their rider portal.`,
    )
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
          <h1>Order review &amp; dispatch</h1>
          <p>
            Review incoming orders, approve them and assign available dispatch
            riders for {user.businessName}.
          </p>
        </div>

        <div className="stats-grid">
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon stat__icon--warning">
                <IconClock size={19} />
              </span>
            </span>
            <span className="stat__value">{pendingReviewCount}</span>
            <span className="stat__label">Pending review</span>
          </div>
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon stat__icon--info">
                <IconPackage size={19} />
              </span>
            </span>
            <span className="stat__value">{awaitingDispatchCount}</span>
            <span className="stat__label">Awaiting dispatch</span>
          </div>
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon">
                <IconTruck size={19} />
              </span>
            </span>
            <span className="stat__value">{inFieldCount}</span>
            <span className="stat__label">In the field</span>
          </div>
          <div className="card stat">
            <span className="stat__top">
              <span className="stat__icon stat__icon--accent">
                <IconCheckCircle size={19} />
              </span>
            </span>
            <span className="stat__value">{businessDeliveredCount}</span>
            <span className="stat__label">Delivered today</span>
          </div>
        </div>

        <section className="section">
          <div className="section-head">
            <h2>Incoming orders</h2>
            <p>Today&apos;s orders — approve, then assign a dispatch rider</p>
          </div>

          <div className="waybill-list">
            {incomingOrders.map((delivery) => (
              <div className="card review-card" key={delivery.id}>
                <div className="review-card__body">
                  <div className="delivery-card__head">
                    <span className="delivery-card__id">
                      <strong>{delivery.waybillNumber}</strong>
                      <span>
                        {delivery.customerName} ·{' '}
                        {formatDateTime(delivery.createdAt)}
                      </span>
                    </span>
                    <StatusBadge status={delivery.status} />
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
                      <span>
                        {delivery.dropOff.line1}, {delivery.dropOff.city}
                      </span>
                    </div>
                  </div>

                  <div className="delivery-card__meta">
                    <span className="meta-item">
                      <IconPhone size={15} />
                      {delivery.recipientName} · {delivery.recipientPhone}
                    </span>
                    {delivery.amountNgn != null && (
                      <span className="meta-item">
                        <IconBuilding size={15} />
                        Order value {formatNgn(delivery.amountNgn)}
                      </span>
                    )}
                  </div>

                  {delivery.status === 'pending_approval' && (
                    <div className="delivery-card__actions">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => handleApprove(delivery)}
                      >
                        <IconCheckCircle size={15} />
                        Approve order
                      </button>
                    </div>
                  )}

                  {delivery.status === 'approved' && (
                    <div className="assign-row">
                      {riders.length === 0 ? (
                        <span className="assign-hint">
                          <IconUsers size={15} />
                          No riders are clocked in. Ask riders to clock in from
                          the Rider Portal.
                        </span>
                      ) : (
                        <>
                          <select
                            className="input input--select"
                            aria-label="Select available rider"
                            value={assignments[delivery.id] ?? ''}
                            onChange={(event) =>
                              setAssignments((current) => ({
                                ...current,
                                [delivery.id]: event.target.value,
                              }))
                            }
                          >
                            <option value="" disabled>
                              Select an available rider…
                            </option>
                            {riders.map((rider) => (
                              <option value={rider.id} key={rider.id}>
                                {rider.fullName} · {rider.phone}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={!assignments[delivery.id]}
                            onClick={() => handleAssign(delivery)}
                          >
                            <IconTruck size={15} />
                            Assign rider
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {incomingOrders.length === 0 && (
              <div className="card empty-state">
                <IconUsers size={26} />
                <p>
                  No incoming orders today. Customer submissions will appear
                  here for approval.
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Today&apos;s order pipeline</h2>
            <p>Orders created on {today.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setHistoryOpen(true)}
            >
              <IconCalendar size={15} />
              Order history
            </button>
          </div>

          <div className="card pipeline-card">
            {pipeline.map((delivery) => (
              <div className="pipeline-row" key={delivery.id}>
                <span className="pipeline-row__id">
                  <strong>{delivery.waybillNumber}</strong>
                  <small>
                    {delivery.customerName} · {delivery.routeLabel}
                  </small>
                </span>
                <span className="pipeline-row__item">
                  {delivery.itemDescription}
                </span>
                <span className="pipeline-row__amount">
                  {delivery.amountNgn != null
                    ? formatNgn(delivery.amountNgn)
                    : '—'}
                </span>
                <StatusBadge status={delivery.status} />
                <span className="pipeline-row__rider">
                  {delivery.riderName ?? 'Unassigned'}
                </span>
              </div>
            ))}

            {pipeline.length === 0 && (
              <div className="empty-state">
                <IconTruck size={26} />
                <p>No orders created today yet.</p>
              </div>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Advertise &amp; boost</h2>
            <p>
              Promote listings and boost deliveries — pay via Flutterwave
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
                    <IconBuilding size={20} />
                  </span>
                  <span className="boost-card__chips">
                    <span
                      className={`badge ${boost.status === 'active' ? 'badge--success' : 'badge--muted'}`}
                    >
                      {boost.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                    <span className="badge badge--info">Business listing</span>
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
                <p>No campaigns yet.</p>
              </div>
            )}
          </div>

          <p className="boost-footnote">
            <IconChevronDown size={14} />
            Boosted deliveries get priority dispatch visibility and a
            &quot;Boosted&quot; badge on the recipient&apos;s tracking view.
          </p>
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

      {historyOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card modal-card--history">
            <div className="modal-card__head">
              <IconCalendar size={18} />
              <strong>Order history</strong>
              <button
                type="button"
                className="modal-close"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close order history"
              >
                <IconX size={16} />
              </button>
            </div>
            <div className="modal-card__body">
              <div className="history-filters">
                <div className="field">
                  <label className="label" htmlFor="history-date">
                    Date
                  </label>
                  <input
                    id="history-date"
                    className="input"
                    type="date"
                    max={toDateInputValue(today)}
                    value={historyDate}
                    onChange={(event) => setHistoryDate(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="history-search">
                    Search
                  </label>
                  <div className="input-with-icon">
                    <IconSearch size={16} className="input-leading-icon" />
                    <input
                      id="history-search"
                      className="input"
                      placeholder="Search by order ID or waybill number…"
                      value={historyQuery}
                      onChange={(event) => setHistoryQuery(event.target.value)}
                    />
                  </div>
                </div>
              </div>

              {!hasHistoryFilters && (
                <div className="card empty-state">
                  <IconSearch size={26} />
                  <p>
                    Pick a date or enter an order ID to look up previous
                    orders.
                  </p>
                </div>
              )}

              {hasHistoryFilters && historyResults.length === 0 && (
                <div className="card empty-state">
                  <IconSearch size={26} />
                  <p>No orders match your search.</p>
                </div>
              )}

              {historyResults.length > 0 && (
                <div className="history-results">
                  {historyResults.map((delivery) => (
                    <div className="history-row" key={delivery.id}>
                      <span className="history-row__id">
                        <strong>{delivery.waybillNumber}</strong>
                        <small>{formatDateTime(delivery.createdAt)}</small>
                      </span>
                      <span className="history-row__amount">
                        {delivery.amountNgn != null
                          ? formatNgn(delivery.amountNgn)
                          : '—'}
                      </span>
                      <StatusBadge status={delivery.status} />
                      <span className="history-row__rider">
                        {delivery.riderName ?? 'Unassigned'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
