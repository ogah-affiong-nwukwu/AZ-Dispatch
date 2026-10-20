import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CustomerOrder,
  NotifyFn,
  OrderEvent,
  OrderProgress,
  User,
  UserRole,
} from '../types'
import type { ThemeMode } from '../utils/storage'
import { formatDateTime, formatNgn } from '../utils/format'
import {
  acceptRiderRequest,
  fetchOrderEvents,
  fetchRiderJobs,
  fetchRiderRequests,
  getOrderProgress,
  riderArrivedDestination,
  riderArrivedPickup,
  riderMarkNotReachable,
  riderMarkNotResponding,
  riderReportFailedDelivery,
  verifyDeliveryCode,
  verifyPickupCode,
} from '../services/orders'
import {
  clockInRider,
  clockOutRider,
  fetchRiderWorkProfile,
  type RiderWorkProfile,
} from '../services/auth'
import { subscribeNotifications } from '../services/notifications'
import { ORDER_STATUS_META } from '../data/orderStatuses'
import { EVENT_LABELS } from '../data/flowSteps'
import {
  DESTINATION_RESPOND_MINUTES,
  PICKUP_WAIT_MINUTES,
} from '../data/flowConstants'
import { DashboardFooter } from './DashboardFooter'
import { DashboardHeader } from './DashboardHeader'
import {
  IconCheckCircle,
  IconChevronDown,
  IconClock,
  IconKey,
  IconMapPin,
  IconNavigation,
  IconPackage,
  IconPower,
  IconTruck,
  IconXCircle,
} from './Icons'
import './../styles/dashboard.css'
import './../styles/dispatcher.css'
import './../styles/rider.css'
import './../styles/flow.css'

interface RiderDashboardProps {
  user: User
  theme: ThemeMode
  roles: UserRole[]
  activeRoleId: string | null
  onToggleTheme: () => void
  onLogout: () => void
  onSwitchRole: (roleId: string) => void
  onAddRole: () => void
  notify: NotifyFn
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
  theme,
  roles,
  activeRoleId,
  onToggleTheme,
  onLogout,
  onSwitchRole,
  onAddRole,
  notify,
}: RiderDashboardProps) {
  const [workProfile, setWorkProfile] = useState<RiderWorkProfile | null>(null)
  const [workLoading, setWorkLoading] = useState(true)
  const isClockedIn = workProfile?.clockedIn === true

  const [vehicleType, setVehicleType] = useState<string>('Motorcycle')
  const [plateNumber, setPlateNumber] = useState('')
  const [serviceZone, setServiceZone] = useState('')
  const [clockErrors, setClockErrors] = useState<string[]>([])
  const [clocking, setClocking] = useState(false)

  const [availableJobs, setAvailableJobs] = useState<CustomerOrder[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [myJobs, setMyJobs] = useState<CustomerOrder[]>([])
  const [acceptBusyId, setAcceptBusyId] = useState<string | null>(null)
  const [actionBusyId, setActionBusyId] = useState<string | null>(null)
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({})
  const [codeErrors, setCodeErrors] = useState<Record<string, string>>({})
  const [progressById, setProgressById] = useState<
    Record<string, OrderProgress | undefined>
  >({})
  const [eventsById, setEventsById] = useState<Record<string, OrderEvent[]>>({})
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({})
  const [notReachableBusyId, setNotReachableBusyId] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const notifyRef = useRef(notify)

  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 15000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let active = true
    fetchRiderWorkProfile(user.id)
      .then((profile) => {
        if (!active) return
        setWorkProfile(profile)
        if (profile) {
          setVehicleType(profile.vehicleType ?? 'Motorcycle')
          setPlateNumber(profile.plateNumber ?? '')
          setServiceZone(profile.zone ?? '')
        }
        setWorkLoading(false)
      })
      .catch(() => {
        if (!active) return
        setWorkLoading(false)
      })
    return () => {
      active = false
    }
  }, [user.id])

  const refreshJobs = useCallback(async () => {
    const [available, mine] = await Promise.all([
      fetchRiderRequests(),
      fetchRiderJobs(user.id),
    ])
    setAvailableJobs(available)
    setMyJobs(mine)
    const next: Record<string, OrderProgress> = {}
    for (const job of mine) {
      const progress = await getOrderProgress(job.id)
      if (progress) next[job.id] = progress
    }
    setProgressById(next)
    setJobsLoading(false)
  }, [user.id])

  useEffect(() => {
    let active = true
    fetchRiderRequests()
      .then((list) => {
        if (!active) return
        setAvailableJobs(list)
        setJobsLoading(false)
      })
      .catch(() => {
        if (!active) return
        setJobsError('Could not load available jobs.')
        setJobsLoading(false)
      })
    fetchRiderJobs(user.id)
      .then((list) => {
        if (!active) return
        setMyJobs(list)
      })
      .catch(() => {
        if (!active) return
        console.warn('[rider] could not load my jobs')
      })
    return () => {
      active = false
    }
  }, [user.id])

  useEffect(() => {
    return subscribeNotifications(user.id, () => {
      void refreshJobs()
    })
  }, [user.id, refreshJobs])

  useEffect(() => {
    for (const job of myJobs) {
      if (
        (job.status === 'arrived_at_pickup' ||
          job.status === 'pickup_verified' ||
          job.status === 'arrived_at_destination') &&
        progressById[job.id] === undefined
      ) {
        void getOrderProgress(job.id).then((progress) => {
          if (progress) {
            setProgressById((current) => ({ ...current, [job.id]: progress }))
          }
        })
      }
    }
  }, [myJobs, progressById])

  const handleClockIn = async () => {
    const issues: string[] = []
    if (!plateNumber.trim()) issues.push('Enter your vehicle plate number.')
    if (!serviceZone.trim()) issues.push('Enter your service zone.')
    setClockErrors(issues)
    if (issues.length > 0) return
    setClocking(true)
    await clockInRider(user.id, {
      vehicleType,
      plateNumber: plateNumber.trim(),
      zone: serviceZone.trim(),
    })
    setWorkProfile({
      clockedIn: true,
      clockedInAt: new Date().toISOString(),
      vehicleType,
      plateNumber: plateNumber.trim(),
      zone: serviceZone.trim(),
    })
    setClocking(false)
    notify('Clocked in — you will see new jobs instantly.')
    void refreshJobs()
  }

  const handleClockOut = async () => {
    await clockOutRider(user.id)
    setWorkProfile((current) =>
      current ? { ...current, clockedIn: false } : null,
    )
    notify('Clocked out.')
  }

  const handleAccept = async (order: CustomerOrder) => {
    setAcceptBusyId(order.id)
    const error = await acceptRiderRequest(order.id)
    setAcceptBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify(`Order ${order.orderNumber} accepted — head to pickup.`)
    void refreshJobs()
  }

  const handleArrivedPickup = async (order: CustomerOrder) => {
    setActionBusyId(order.id)
    const error = await riderArrivedPickup(order.id)
    setActionBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify(
      order.businessUserId
        ? 'You are at pickup — wait for the customer to get the code from the business.'
        : 'Order marked as picked up.',
    )
    void refreshJobs()
  }

  const handleVerifyPickupCode = async (order: CustomerOrder) => {
    const code = codeInputs[order.id] ?? ''
    if (code.length !== 6) {
      setCodeErrors((current) => ({
        ...current,
        [order.id]: 'Enter the 6-digit pickup code.',
      }))
      return
    }
    setActionBusyId(order.id)
    const result = await verifyPickupCode(order.id, code)
    setActionBusyId(null)
    if (result.error) {
      setCodeErrors((current) => ({ ...current, [order.id]: result.error as string }))
      void refreshJobs()
      return
    }
    if (result.ok) {
      notify('Pickup code correct. Waiting for the business to confirm you.')
    } else {
      setCodeErrors((current) => ({
        ...current,
        [order.id]: 'Incorrect code — try again.',
      }))
    }
    void refreshJobs()
  }

  const handleArrivedDestination = async (order: CustomerOrder) => {
    setActionBusyId(order.id)
    const error = await riderArrivedDestination(order.id)
    setActionBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('You are at the destination — ask the customer for their delivery code.')
    void refreshJobs()
  }

  const handleVerifyDeliveryCode = async (order: CustomerOrder) => {
    const code = codeInputs[order.id] ?? ''
    if (code.length !== 6) {
      setCodeErrors((current) => ({
        ...current,
        [order.id]: 'Enter the 6-digit delivery code.',
      }))
      return
    }
    setActionBusyId(order.id)
    const result = await verifyDeliveryCode(order.id, code)
    setActionBusyId(null)
    if (result.error) {
      setCodeErrors((current) => ({ ...current, [order.id]: result.error as string }))
      void refreshJobs()
      return
    }
    if (result.ok) {
      setCodeInputs((current) => {
        const next = { ...current }
        delete next[order.id]
        return next
      })
      notify('Delivery code correct — waiting for the customer to confirm receipt.')
    } else {
      setCodeErrors((current) => ({
        ...current,
        [order.id]: 'Incorrect code — try again.',
      }))
    }
    void refreshJobs()
  }

  const eventTime = (orderId: string, event: string): number | null => {
    const list = eventsById[orderId] ?? []
    const found = list.find((item) => item.event === event)
    return found ? new Date(found.createdAt).getTime() : null
  }

  const toggleHistory = async (order: CustomerOrder) => {
    const next = !historyOpen[order.id]
    setHistoryOpen((current) => ({ ...current, [order.id]: next }))
    if (next && !eventsById[order.id]) {
      const list = await fetchOrderEvents(order.id)
      setEventsById((current) => ({ ...current, [order.id]: list }))
    }
  }

  const handleNotReachable = async (order: CustomerOrder) => {
    setNotReachableBusyId(order.id)
    const error = await riderMarkNotReachable(order.id)
    setNotReachableBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Reported — the business can keep waiting or cancel.')
    void refreshJobs()
  }

  const handleNotResponding = async (order: CustomerOrder) => {
    setNotReachableBusyId(order.id)
    const error = await riderMarkNotResponding(order.id)
    setNotReachableBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Reported — the customer has 15 minutes in total.')
    void refreshJobs()
  }

  const handleReportFailed = async (order: CustomerOrder) => {
    const reason = window.prompt(
      `Why did delivery fail for order ${order.orderNumber}?`,
    )
    if (!reason?.trim()) return
    setNotReachableBusyId(order.id)
    const error = await riderReportFailedDelivery(order.id, reason.trim())
    setNotReachableBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Delivery reported failed — the order returns to the business.')
    void refreshJobs()
  }

  const renderJobActions = (order: CustomerOrder) => {
    const progress = progressById[order.id]
    switch (order.status) {
      case 'rider_accepted': {
        if (order.businessUserId && !progress?.ready) {
          return (
            <div className="confirm-box">
              <span className="label">
                <IconClock size={14} /> The business is still preparing the
                order
              </span>
              <p>
                You can arrive only after the business marks the order ready
                for pickup.
              </p>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled
              >
                <IconMapPin size={15} />
                I&apos;ve arrived at pickup
              </button>
            </div>
          )
        }
        return (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={actionBusyId === order.id}
            onClick={() => handleArrivedPickup(order)}
          >
            <IconMapPin size={15} />
            {order.businessUserId
              ? "I've arrived at pickup"
              : 'Picked up'}
          </button>
        )
      }
      case 'arrived_at_pickup':
      case 'pickup_verified': {
        if (!order.businessUserId) return null
        if (progress?.pickupLocked) {
          return (
            <div className="auth__error">
              <IconKey size={15} /> Pickup step locked — too many wrong
              attempts.
            </div>
          )
        }
        const arrivedAt = eventTime(order.id, 'arrived_pickup')
        const waitedMs = arrivedAt ? Date.now() - arrivedAt : 0
        const canReport = arrivedAt !== null && waitedMs >= PICKUP_WAIT_MINUTES * 60000
        const notReachableSection =
          progress?.waitingDeadline != null ? (
            <p className="meta-item meta-item--pending">
              <IconClock size={14} /> Customer not reachable — the business can
              keep waiting or cancel.
            </p>
          ) : canReport ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={notReachableBusyId === order.id}
              onClick={() => handleNotReachable(order)}
            >
              <IconXCircle size={15} />
              Customer not reachable
            </button>
          ) : (
            <p className="meta-item">
              <IconClock size={14} /> Waiting for the phone-call step —{' '}
              {Math.max(
                0,
                Math.ceil((PICKUP_WAIT_MINUTES * 60000 - waitedMs) / 60000),
              )}{' '}
              minute(s) before you can report the customer unreachable.
            </p>
          )
        return (
          <div className="confirm-box">
            <span className="label">Pickup code</span>
            <p>Type the 6-digit code the customer gives you over the phone.</p>
            <div className="confirm-box__row">
              <input
                className="input confirm-box__code"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••••"
                aria-label="6-digit pickup code"
                value={codeInputs[order.id] ?? ''}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, '')
                  setCodeInputs((current) => ({ ...current, [order.id]: value }))
                  setCodeErrors((current) => {
                    const next = { ...current }
                    delete next[order.id]
                    return next
                  })
                }}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={actionBusyId === order.id}
                onClick={() => handleVerifyPickupCode(order)}
              >
                <IconKey size={15} />
                Verify pickup
              </button>
            </div>
            {progress?.pickupVerified && (
              <p className="meta-item meta-item--pending">
                <IconClock size={14} /> Waiting for the business to confirm
                you.
              </p>
            )}
            {codeErrors[order.id] && (
              <p className="field-error">{codeErrors[order.id]}</p>
            )}
            {notReachableSection}
          </div>
        )
      }
      case 'picked_up':
        return (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={actionBusyId === order.id}
            onClick={() => handleArrivedDestination(order)}
          >
            <IconNavigation size={15} />
            I&apos;ve arrived at destination
          </button>
        )
      case 'arrived_at_destination': {
        if (progress?.deliveryLocked) {
          return (
            <div className="auth__error">
              <IconKey size={15} /> Delivery step locked — too many wrong
              attempts.
            </div>
          )
        }
        const arrivedAt = eventTime(order.id, 'arrived_destination')
        const waitedMs = arrivedAt ? Date.now() - arrivedAt : 0
        const deadline = progress?.waitingDeadline
          ? new Date(progress.waitingDeadline).getTime()
          : null
        const canReportResponding =
          deadline === null &&
          arrivedAt !== null &&
          waitedMs >= DESTINATION_RESPOND_MINUTES * 60000
        const canReportFailed = deadline !== null && deadline <= Date.now()
        const waitingSection =
          deadline !== null ? (
            canReportFailed ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={notReachableBusyId === order.id}
                onClick={() => handleReportFailed(order)}
              >
                <IconXCircle size={15} />
                Report failed delivery
              </button>
            ) : (
              <p className="meta-item meta-item--pending">
                <IconClock size={14} /> Customer not responding —{' '}
                {Math.max(0, Math.ceil((deadline - Date.now()) / 60000))} minute(s)
                before you can report a failed delivery.
              </p>
            )
          ) : canReportResponding ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={notReachableBusyId === order.id}
              onClick={() => handleNotResponding(order)}
            >
              <IconXCircle size={15} />
              Customer not responding
            </button>
          ) : (
            <p className="meta-item">
              <IconClock size={14} /> Waiting for the customer —{' '}
              {Math.max(
                0,
                Math.ceil(
                  (DESTINATION_RESPOND_MINUTES * 60000 - waitedMs) / 60000,
                ),
              )}{' '}
              minute(s) before you can report them as not responding.
            </p>
          )
        if (progress?.deliveryVerified) {
          return (
            <div className="confirm-box">
              <p className="meta-item meta-item--pending">
                <IconClock size={14} /> Code verified — waiting for the customer
                to confirm receipt.
              </p>
            </div>
          )
        }
        return (
          <div className="confirm-box">
            <span className="label">Delivery code</span>
            <p>Ask the customer for their 6-digit delivery code.</p>
            <div className="confirm-box__row">
              <input
                className="input confirm-box__code"
                inputMode="numeric"
                maxLength={6}
                placeholder="••••••"
                aria-label="6-digit delivery code"
                value={codeInputs[order.id] ?? ''}
                onChange={(event) => {
                  const value = event.target.value.replace(/\D/g, '')
                  setCodeInputs((current) => ({ ...current, [order.id]: value }))
                  setCodeErrors((current) => {
                    const next = { ...current }
                    delete next[order.id]
                    return next
                  })
                }}
              />
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={actionBusyId === order.id}
                onClick={() => handleVerifyDeliveryCode(order)}
              >
                <IconKey size={15} />
                Verify delivery
              </button>
            </div>
            {codeErrors[order.id] && (
              <p className="field-error">{codeErrors[order.id]}</p>
            )}
            {waitingSection}
          </div>
        )
      }
      case 'delivered':
        return (
          <div className="confirm-box confirm-box--done">
            <IconCheckCircle size={18} />
            Delivered — job complete.
          </div>
        )
      case 'cancelled':
        return (
          <div className="confirm-box confirm-box--failed">
            <IconXCircle size={18} />
            Order cancelled — you are released from this job.
          </div>
        )
      case 'delivery_failed':
        return (
          <div className="confirm-box confirm-box--failed">
            <IconXCircle size={18} />
            Delivery reported failed — the order is returned to the business.
          </div>
        )
      default:
        return null
    }
  }

  const jobSummary = (order: CustomerOrder) => {
    if (order.kind === 'rider_only') return order.itemDescription ?? ''
    return (order.items ?? [])
      .map((line) => `${line.itemName} × ${line.quantity}`)
      .join(', ')
  }

  return (
    <div className="dashboard">
      <DashboardHeader
        user={user}
        theme={theme}
        roles={roles}
        activeRoleId={activeRoleId}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
        onSwitchRole={onSwitchRole}
        onAddRole={onAddRole}
      />

      <main className="dash-main container">
        <div className="page-head">
          <h1>Rider portal</h1>
          <p>Clock in, accept jobs and run the pickup and delivery flow.</p>
        </div>

        <div className="card clock-card">
          <div className="clock-card__head">
            <span
              className={`badge ${isClockedIn ? 'badge--success' : 'badge--muted'}`}
            >
              <IconPower size={13} />
              {isClockedIn ? 'Clocked in' : 'Clocked out'}
            </span>
            {isClockedIn ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void handleClockOut()}
              >
                Clock out
              </button>
            ) : (
              <>
                <div className="clock-card__form">
                  <select
                    className="input input--select"
                    value={vehicleType}
                    onChange={(event) => setVehicleType(event.target.value)}
                    aria-label="Vehicle type"
                  >
                    {VEHICLE_OPTIONS.map((option) => (
                      <option value={option} key={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder="Plate number e.g. KJA 123 QA"
                    value={plateNumber}
                    onChange={(event) => setPlateNumber(event.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Service zone e.g. Ikeja"
                    value={serviceZone}
                    onChange={(event) => setServiceZone(event.target.value)}
                  />
                </div>
                {clockErrors.length > 0 && (
                  <div className="auth__error">{clockErrors.join(' ')}</div>
                )}
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  disabled={clocking || workLoading}
                  onClick={() => void handleClockIn()}
                >
                  <IconPower size={15} />
                  {clocking ? 'Clocking in…' : 'Clock in'}
                </button>
              </>
            )}
          </div>
        </div>

        {isClockedIn && (
          <section className="section">
            <div className="section-head">
              <h2>Available requests</h2>
              <p>Visible only to clocked-in riders — first to accept gets it</p>
            </div>

            {jobsLoading ? (
              <div className="card empty-state">
                <span className="spinner" aria-hidden="true" />
                <p>Loading jobs…</p>
              </div>
            ) : jobsError ? (
              <div className="auth__error">{jobsError}</div>
            ) : availableJobs.length === 0 ? (
              <div className="card empty-state">
                <IconPackage size={26} />
                <p>No requests waiting right now.</p>
              </div>
            ) : (
              <div className="order-list">
                {availableJobs.map((order) => (
                  <div className="card order-card" key={order.id}>
                    <div className="order-card__head">
                      <span className="order-card__id">
                        <strong>{order.orderNumber}</strong>
                        <small>{formatDateTime(order.createdAt)}</small>
                      </span>
                      <span
                        className={`badge ${(ORDER_STATUS_META[order.status] ?? ORDER_STATUS_META.placed).badge}`}
                      >
                        {(ORDER_STATUS_META[order.status] ?? ORDER_STATUS_META.placed).label}
                      </span>
                    </div>
                    <p className="delivery-card__item">
                      <IconPackage size={14} />
                      {jobSummary(order)}
                    </p>
                    <div className="route">
                      <div className="route__stop">
                        <small>Pickup</small>
                        <strong>{order.pickupAddress?.label ?? 'Pickup'}</strong>
                        <span>
                          {order.pickupAddress?.line1}
                          {order.pickupPhone ? ` · ${order.pickupPhone}` : ''}
                        </span>
                      </div>
                      <span className="route__arrow">
                        <IconNavigation size={17} />
                      </span>
                      <div className="route__stop">
                        <small>Drop-off</small>
                        <strong>{order.deliveryAddress?.label ?? 'Drop-off'}</strong>
                        <span>{order.deliveryAddress?.line1}</span>
                      </div>
                    </div>
                    {order.kind === 'rider_only' && (
                      <div className="delivery-card__meta">
                        <span className="meta-item">
                          Fee {formatNgn(order.deliveryFeeNaira)}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      disabled={acceptBusyId === order.id}
                      onClick={() => handleAccept(order)}
                    >
                      <IconTruck size={15} />
                      {acceptBusyId === order.id ? 'Accepting…' : 'Accept job'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="section">
          <div className="section-head">
            <h2>My jobs</h2>
            <p>Pickup and delivery steps with one-time codes</p>
          </div>

          {myJobs.length === 0 ? (
            <div className="card empty-state">
              <IconTruck size={26} />
              <p>No jobs assigned yet — accepted orders appear here.</p>
            </div>
          ) : (
            <div className="order-list">
              {myJobs.map((order) => (
                <div className="card order-card" key={order.id}>
                  <div className="order-card__head">
                    <span className="order-card__id">
                      <strong>{order.orderNumber}</strong>
                      <small>{formatDateTime(order.createdAt)}</small>
                    </span>
                    <span
                      className={`badge ${(ORDER_STATUS_META[order.status] ?? ORDER_STATUS_META.placed).badge}`}
                    >
                      {(ORDER_STATUS_META[order.status] ?? ORDER_STATUS_META.placed).label}
                    </span>
                  </div>
                  <p className="delivery-card__item">
                    <IconPackage size={14} />
                    {jobSummary(order)}
                  </p>
                  <div className="route">
                    <div className="route__stop">
                      <small>Pickup</small>
                      <strong>{order.pickupAddress?.label ?? 'Pickup'}</strong>
                      <span>{order.pickupAddress?.line1}</span>
                    </div>
                    <span className="route__arrow">
                      <IconNavigation size={17} />
                    </span>
                    <div className="route__stop">
                      <small>Drop-off</small>
                      <strong>{order.deliveryAddress?.label ?? 'Drop-off'}</strong>
                      <span>{order.deliveryAddress?.line1}</span>
                    </div>
                  </div>
                  {renderJobActions(order)}

                  <button
                    type="button"
                    className="timeline-toggle"
                    onClick={() => void toggleHistory(order)}
                  >
                    <IconChevronDown
                      size={16}
                      className={
                        historyOpen[order.id] ? 'chevron-flip' : ''
                      }
                    />
                    {historyOpen[order.id]
                      ? 'Hide order history'
                      : 'Order history'}
                  </button>

                  {historyOpen[order.id] && (
                    <div className="event-history">
                      {(eventsById[order.id] ?? []).map((event) => (
                        <div className="event-history__row" key={event.id}>
                          <span className="event-history__dot" />
                          <span className="event-history__text">
                            <strong>
                              {EVENT_LABELS[event.event] ?? event.event}
                            </strong>
                            {event.details && (
                              <small> · {event.details}</small>
                            )}
                            <small>
                              {' '}
                              · {formatDateTime(event.createdAt)} ·{' '}
                              {event.actorRole ?? 'system'}
                            </small>
                          </span>
                        </div>
                      ))}
                      {(eventsById[order.id] ?? []).length === 0 && (
                        <p className="notif-state">No events yet.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <DashboardFooter />
    </div>
  )
}
