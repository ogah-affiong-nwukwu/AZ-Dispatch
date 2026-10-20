import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomerOrder, OrderEvent } from '../types'
import { ORDER_STATUS_META } from '../data/orderStatuses'
import { EVENT_LABELS, stepStates } from '../data/flowSteps'
import {
  NO_RIDER_TIMEOUT_MINUTES,
  REQUEST_REMINDER_MINUTES,
} from '../data/flowConstants'
import {
  customerCancelRequest,
  customerConfirmReceived,
  fetchOrderEvents,
  getDeliveryCode,
  notifyNoRider,
  sendRequestReminder,
} from '../services/orders'
import { formatDateTime, formatNgn } from '../utils/format'
import {
  IconCheckCircle,
  IconChevronDown,
  IconClock,
  IconKey,
  IconPackage,
  IconTruck,
  IconXCircle,
} from './Icons'
import './../styles/customer.css'
import './../styles/flow.css'

interface CustomerOrdersSectionProps {
  orders: CustomerOrder[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onRequestRider: (order: CustomerOrder) => void
  notify: (text: string, tone?: 'success' | 'error' | 'info') => void
}

const CANCELLABLE: CustomerOrder['status'][] = [
  'placed',
  'accepted_by_business',
  'ready_for_pickup',
  'rider_requested',
  'rider_accepted',
  'arrived_at_pickup',
  'pickup_verified',
]

function minutesLeft(deadline: string | null): number {
  if (!deadline) return 0
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 60000))
}

export function CustomerOrdersSection({
  orders,
  loading,
  error,
  onRefresh,
  onRequestRider,
  notify,
}: CustomerOrdersSectionProps) {
  const [codes, setCodes] = useState<Record<string, string | null>>({})
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [noRiderOptions, setNoRiderOptions] = useState<Set<string>>(new Set())
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({})
  const [events, setEvents] = useState<Record<string, OrderEvent[]>>({})
  const [tick, setTick] = useState(0)
  const noRiderSent = useRef(new Set<string>())
  const reminderSent = useRef(new Map<string, Set<number>>())
  const waitReset = useRef(new Map<string, number>())

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 15000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const now = Date.now()
    for (const order of orders) {
      if (order.kind !== 'shop') continue

      if (
        order.status === 'placed' ||
        order.status === 'accepted_by_business' ||
        order.status === 'ready_for_pickup'
      ) {
        const base = new Date(order.createdAt).getTime()
        const sent = reminderSent.current.get(order.id) ?? new Set<number>()
        for (const minute of REQUEST_REMINDER_MINUTES) {
          if (!sent.has(minute) && now - base >= minute * 60000) {
            sent.add(minute)
            reminderSent.current.set(order.id, sent)
            void sendRequestReminder(order.id)
          }
        }
      }

      if (order.status === 'rider_requested') {
        const base =
          waitReset.current.get(order.id) ??
          new Date(order.riderRequestedAt ?? order.updatedAt).getTime()
        if (
          !noRiderSent.current.has(order.id) &&
          now - base >= NO_RIDER_TIMEOUT_MINUTES * 60000
        ) {
          noRiderSent.current.add(order.id)
          void notifyNoRider(order.id)
          setNoRiderOptions((current) => new Set(current).add(order.id))
        }
      }
    }
  }, [tick, orders])

  const loadCode = useCallback(
    async (order: CustomerOrder) => {
      if (order.status !== 'arrived_at_destination') return
      const code = await getDeliveryCode(order.id)
      setCodes((current) => ({ ...current, [order.id]: code }))
    },
    [],
  )

  useEffect(() => {
    for (const order of orders) {
      if (
        order.status === 'arrived_at_destination' &&
        codes[order.id] === undefined
      ) {
        void loadCode(order)
      }
    }
  }, [orders, codes, loadCode])

  const handleConfirmReceived = async (order: CustomerOrder) => {
    setConfirmingId(order.id)
    const error = await customerConfirmReceived(order.id)
    setConfirmingId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Delivery confirmed — thank you!')
    onRefresh()
  }

  const handleCancel = async (order: CustomerOrder) => {
    const confirmed = window.confirm(
      `Cancel order ${order.orderNumber}? This cannot be undone.`,
    )
    if (!confirmed) return
    setCancellingId(order.id)
    const error = await customerCancelRequest(order.id)
    setCancellingId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Order cancelled.')
    onRefresh()
  }

  const handleKeepWaiting = (order: CustomerOrder) => {
    waitReset.current.set(order.id, Date.now())
    noRiderSent.current.delete(order.id)
    setNoRiderOptions((current) => {
      const next = new Set(current)
      next.delete(order.id)
      return next
    })
    notify('Timer restarted — we will check again shortly.')
  }

  const toggleHistory = async (order: CustomerOrder) => {
    const next = !historyOpen[order.id]
    setHistoryOpen((current) => ({ ...current, [order.id]: next }))
    if (next && !events[order.id]) {
      const list = await fetchOrderEvents(order.id)
      setEvents((current) => ({ ...current, [order.id]: list }))
    }
  }

  const renderTimeline = (order: CustomerOrder) => {
    const steps = stepStates(order)
    return (
      <div className="flow-timeline">
        {steps.map((step) => (
          <div
            className={`flow-timeline__step ${
              step.state === 'done'
                ? 'flow-timeline__step--done'
                : step.state === 'current'
                  ? 'flow-timeline__step--current'
                  : ''
            }`}
            key={step.status}
          >
            <span className="flow-timeline__dot">
              {step.state === 'done' ? <IconCheckCircle size={13} /> : null}
            </span>
            <span className="flow-timeline__label">{step.label}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2>My orders</h2>
        <p>Live status and the full journey for every order</p>
      </div>

      {loading ? (
        <div className="card empty-state">
          <span className="spinner" aria-hidden="true" />
          <p>Loading orders…</p>
        </div>
      ) : error ? (
        <div className="auth__error">{error}</div>
      ) : orders.length === 0 ? (
        <div className="card empty-state">
          <IconPackage size={26} />
          <p>No orders yet — your orders appear here with a live timeline.</p>
        </div>
      ) : (
        <div className="order-list">
          {orders.map((order) => {
            const meta = ORDER_STATUS_META[order.status]
            return (
              <div className="card order-card" key={order.id}>
                <div className="order-card__head">
                  <span className="order-card__id">
                    <strong>{order.orderNumber}</strong>
                    <small>{formatDateTime(order.createdAt)}</small>
                  </span>
                  <span className={`badge ${meta.badge}`}>{meta.label}</span>
                </div>

                <div className="order-card__items">
                  {order.kind === 'rider_only' && order.itemDescription && (
                    <span className="order-card__item">
                      <strong>Item</strong>
                      <span>{order.itemDescription}</span>
                    </span>
                  )}
                  {order.items.map((line) => (
                    <span key={line.id} className="order-card__item">
                      <strong>
                        {line.itemName} × {line.quantity}
                      </strong>
                      <span>{formatNgn(line.unitPriceNaira * line.quantity)}</span>
                    </span>
                  ))}
                  {order.kind === 'rider_only' && (
                    <span className="order-card__item">
                      <strong>Delivery fee</strong>
                      <span>{formatNgn(order.deliveryFeeNaira)}</span>
                    </span>
                  )}
                  <span className="order-card__item order-card__item--total">
                    <strong>Total</strong>
                    <span>{formatNgn(order.totalNaira)}</span>
                  </span>
                </div>

                {order.deliveryAddress && (
                  <p className="order-card__address">
                    Deliver to: {order.deliveryAddress.label} ·{' '}
                    {order.deliveryAddress.line1}, {order.deliveryAddress.city},{' '}
                    {order.deliveryAddress.state}
                  </p>
                )}

                {order.status !== 'cancelled' &&
                  order.status !== 'delivery_failed' &&
                  renderTimeline(order)}

                {order.kind === 'shop' &&
                  (order.status === 'placed' ||
                    order.status === 'accepted_by_business' ||
                    order.status === 'ready_for_pickup') && (
                    <div className="confirm-box">
                      <span className="label">
                        Waiting for you to request a rider
                      </span>
                      <p>
                        Your order is placed
                        {order.businessAcceptedAt
                          ? ' and the business accepted it'
                          : ''}
                        {order.readyAt ? ' and it is ready for pickup' : ''}.
                        Request a rider to bring it to you.
                      </p>
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => onRequestRider(order)}
                      >
                        <IconTruck size={16} />
                        Request a rider
                      </button>
                    </div>
                  )}

                {order.status === 'rider_requested' &&
                  noRiderOptions.has(order.id) && (
                    <div className="confirm-box">
                      <span className="label">No rider accepted yet</span>
                      <p>
                        It has been more than {NO_RIDER_TIMEOUT_MINUTES} minutes
                        with no rider. Keep waiting or cancel the request.
                      </p>
                      <div className="form-actions">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          onClick={() => handleKeepWaiting(order)}
                        >
                          <IconClock size={15} />
                          Keep waiting
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={cancellingId === order.id}
                          onClick={() => handleCancel(order)}
                        >
                          <IconXCircle size={15} />
                          Cancel request
                        </button>
                      </div>
                    </div>
                  )}

                {(order.status === 'arrived_at_pickup' ||
                  order.status === 'pickup_verified') &&
                  order.waitingDeadline && (
                    <div className="confirm-box">
                      <span className="label">Customer not reachable</span>
                      <p>
                        The rider could not reach you. The business can keep
                        waiting or cancel — {minutesLeft(order.waitingDeadline)}{' '}
                        minute(s) left on the countdown.
                      </p>
                    </div>
                  )}

                {order.status === 'arrived_at_destination' && (
                  <div className="confirm-box confirm-box--success">
                    <span className="label">Rider is at your door</span>
                    <p>
                      Give this delivery code to the rider — never to anyone
                      else:
                    </p>
                    <span className="otp-code">
                      {codes[order.id]
                        ? codes[order.id]!.replace(/(\d{3})(\d{3})/, '$1 $2')
                        : '——'}
                    </span>
                    {order.waitingDeadline && (
                      <p>
                        <IconClock size={14} /> The rider reported you as not
                        responding — {minutesLeft(order.waitingDeadline)} minute(s)
                        before the delivery can be reported failed.
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={confirmingId === order.id}
                      onClick={() => handleConfirmReceived(order)}
                    >
                      <IconKey size={16} />
                      {confirmingId === order.id
                        ? 'Confirming…'
                        : 'I have received my order'}
                    </button>
                  </div>
                )}

                {order.status === 'delivered' && (
                  <div className="confirm-box confirm-box--done">
                    <IconCheckCircle size={18} />
                    Order delivered — thank you for using AZ Delivery.
                  </div>
                )}

                {order.status === 'delivery_failed' && (
                  <div className="confirm-box confirm-box--failed">
                    <IconXCircle size={18} />
                    Delivery failed — the order is being returned to the
                    business
                    {order.failureReason ? `: ${order.failureReason}` : ''}.
                  </div>
                )}

                {order.status === 'cancelled' && (
                  <div className="confirm-box confirm-box--failed">
                    <IconXCircle size={18} />
                    Order cancelled
                    {order.declineReason ? `: ${order.declineReason}` : ''}.
                  </div>
                )}

                {CANCELLABLE.includes(order.status) && (
                  <div className="order-card__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={cancellingId === order.id}
                      onClick={() => handleCancel(order)}
                    >
                      <IconXCircle size={15} />
                      Cancel order
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="timeline-toggle"
                  onClick={() => void toggleHistory(order)}
                >
                  <IconChevronDown
                    size={16}
                    className={historyOpen[order.id] ? 'chevron-flip' : ''}
                  />
                  {historyOpen[order.id] ? 'Hide order history' : 'Order history'}
                </button>

                {historyOpen[order.id] && (
                  <div className="event-history">
                    {(events[order.id] ?? []).map((event) => (
                      <div className="event-history__row" key={event.id}>
                        <span className="event-history__dot" />
                        <span className="event-history__text">
                          <strong>
                            {EVENT_LABELS[event.event] ?? event.event}
                          </strong>
                          {event.details && <small> · {event.details}</small>}
                          <small>
                            {' '}
                            · {formatDateTime(event.createdAt)} ·{' '}
                            {event.actorRole ?? 'system'}
                          </small>
                        </span>
                      </div>
                    ))}
                    {(events[order.id] ?? []).length === 0 && (
                      <p className="notif-state">No events yet.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
