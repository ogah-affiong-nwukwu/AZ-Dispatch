import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BoostItem,
  BusinessProfile,
  Item,
  ItemInput,
  NotifyFn,
  RiderIdentity,
  User,
  UserRole,
} from '../types'
import type { ThemeMode } from '../utils/storage'
import { formatDateTime, formatNgn } from '../utils/format'
import {
  addItemPhotos,
  createItem,
  deleteItem,
  fetchBusinessItems,
  removeItemPhoto,
  setItemAvailability,
  updateItem,
} from '../services/items'
import {
  businessAcceptOrder,
  businessCancelOrder,
  businessConfirmRider,
  businessDeclineOrder,
  businessExtendWaiting,
  businessMarkReady,
  fetchBusinessOrders,
  fetchOrderEvents,
  getPickupCode,
  getRiderIdentity,
  type OrderReview,
} from '../services/orders'
import {
  fetchBusinessProfile,
  hasBusinessDetails,
  saveBusinessDetails,
  validateBusinessPhone,
} from '../services/business'
import { subscribeNotifications } from '../services/notifications'
import { ORDER_STATUS_META } from '../data/orderStatuses'
import { EVENT_LABELS } from '../data/flowSteps'
import type { OrderEvent } from '../types'
import { DashboardFooter } from './DashboardFooter'
import { DashboardHeader } from './DashboardHeader'
import { FlutterwaveModal } from './FlutterwaveModal'
import { ItemFormModal } from './ItemFormModal'
import {
  IconBuilding,
  IconCheckCircle,
  IconChevronDown,
  IconClock,
  IconImage,
  IconMegaphone,
  IconPackage,
  IconTruck,
  IconXCircle,
} from './Icons'
import './../styles/dashboard.css'
import './../styles/dispatcher.css'
import './../styles/items.css'
import './../styles/customer.css'
import './../styles/flow.css'

interface BusinessDashboardProps {
  user: User
  boosts: BoostItem[]
  theme: ThemeMode
  roles: UserRole[]
  activeRoleId: string | null
  onToggleTheme: () => void
  onLogout: () => void
  onSwitchRole: (roleId: string) => void
  onAddRole: () => void
  activateBoost: (item: BoostItem, reference: string) => void
  notify: NotifyFn
}

export function BusinessDashboard({
  user,
  boosts,
  theme,
  roles,
  activeRoleId,
  onToggleTheme,
  onLogout,
  onSwitchRole,
  onAddRole,
  activateBoost,
  notify,
}: BusinessDashboardProps) {
  const [boostTarget, setBoostTarget] = useState<BoostItem | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState<string | null>(null)
  const [itemModal, setItemModal] = useState<
    { mode: 'create' } | { mode: 'edit'; item: Item } | null
  >(null)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [orders, setOrders] = useState<OrderReview[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [detailName, setDetailName] = useState('')
  const [detailAddress, setDetailAddress] = useState('')
  const [detailPhone, setDetailPhone] = useState('')
  const [detailError, setDetailError] = useState<string | null>(null)
  const [savingDetails, setSavingDetails] = useState(false)
  const [pickupCodes, setPickupCodes] = useState<Record<string, string | null>>({})
  const [riders, setRiders] = useState<Record<string, RiderIdentity | null>>({})
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null)
  const [prepInputs, setPrepInputs] = useState<Record<string, string>>({})
  const [acceptBusyId, setAcceptBusyId] = useState<string | null>(null)
  const [readyBusyId, setReadyBusyId] = useState<string | null>(null)
  const [declineBusyId, setDeclineBusyId] = useState<string | null>(null)
  const [waitBusyId, setWaitBusyId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({})
  const [events, setEvents] = useState<Record<string, OrderEvent[]>>({})
  const [, setTick] = useState(0)
  const notifyRef = useRef(notify)

  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 15000)
    return () => clearInterval(id)
  }, [])

  const handleAcceptOrder = async (order: OrderReview) => {
    const raw = prepInputs[order.id] ?? ''
    const minutes = raw === '' ? undefined : Number(raw)
    if (raw !== '' && (!Number.isFinite(minutes) || (minutes as number) < 0)) {
      notify('Enter a valid preparation time in minutes.', 'error')
      return
    }
    setAcceptBusyId(order.id)
    const error = await businessAcceptOrder(order.id, minutes)
    setAcceptBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Order accepted.')
    await refreshOrders()
  }

  const handleMarkReady = async (order: OrderReview) => {
    setReadyBusyId(order.id)
    const error = await businessMarkReady(order.id)
    setReadyBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Order marked ready for pickup — the rider and customer are notified.')
    await refreshOrders()
  }

  const handleDecline = async (order: OrderReview) => {
    const reason = window.prompt(
      `Why are you declining order ${order.orderNumber}?`,
    )
    if (!reason?.trim()) return
    setDeclineBusyId(order.id)
    const error = await businessDeclineOrder(order.id, reason.trim())
    setDeclineBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Order declined — the customer is notified.')
    await refreshOrders()
  }

  const handleExtendWaiting = async (order: OrderReview) => {
    setWaitBusyId(order.id)
    const error = await businessExtendWaiting(order.id)
    setWaitBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Waiting extended by 5 minutes.')
    await refreshOrders()
  }

  const handleCancelWaiting = async (order: OrderReview) => {
    const reason = window.prompt(
      `Why are you cancelling order ${order.orderNumber}?`,
    )
    if (!reason?.trim()) return
    setWaitBusyId(order.id)
    const error = await businessCancelOrder(order.id, reason.trim())
    setWaitBusyId(null)
    if (error) {
      notify(error, 'error')
      return
    }
    notify('Order cancelled — the rider is released.')
    await refreshOrders()
  }

  const toggleHistory = async (order: OrderReview) => {
    const next = !historyOpen[order.id]
    setHistoryOpen((current) => ({ ...current, [order.id]: next }))
    if (next && !events[order.id]) {
      const list = await fetchOrderEvents(order.id)
      setEvents((current) => ({ ...current, [order.id]: list }))
    }
  }

  const minutesLeft = (deadline: string | null): number => {
    if (!deadline) return 0
    return Math.max(
      0,
      Math.ceil((new Date(deadline).getTime() - Date.now()) / 60000),
    )
  }

  const detailsReady = hasBusinessDetails(profile)

  const refreshItems = useCallback(async () => {
    setItems(await fetchBusinessItems(user.id))
  }, [user.id])

  const refreshOrders = useCallback(async () => {
    setOrders(await fetchBusinessOrders(user.id))
  }, [user.id])

  const refreshProfile = useCallback(async () => {
    const next = await fetchBusinessProfile(user.id)
    setProfile(next)
    if (next) {
      setDetailName(next.businessName)
      setDetailAddress(next.businessAddress ?? '')
      setDetailPhone(next.businessPhone ?? '')
    }
  }, [user.id])

  useEffect(() => {
    let active = true
    fetchBusinessOrders(user.id)
      .then((list) => {
        if (!active) return
        setOrders(list)
        setOrdersLoading(false)
      })
      .catch(() => {
        if (!active) return
        setOrdersError('Could not load your orders.')
        setOrdersLoading(false)
      })
    return () => {
      active = false
    }
  }, [user.id])

  useEffect(() => {
    let active = true
    fetchBusinessItems(user.id)
      .then((list) => {
        if (!active) return
        setItems(list)
        setItemsLoading(false)
      })
      .catch(() => {
        if (!active) return
        setItemsError('Could not load your items.')
        setItemsLoading(false)
      })
    return () => {
      active = false
    }
  }, [user.id])

  useEffect(() => {
    void refreshProfile()
  }, [refreshProfile])

  useEffect(() => {
    return subscribeNotifications(user.id, (notification) => {
      notifyRef.current(
        notification.kind === 'order'
          ? notification.body
          : `${notification.title}: ${notification.body}`,
      )
      void refreshOrders()
    })
  }, [user.id, refreshOrders])

  useEffect(() => {
    for (const order of orders) {
      if (
        (order.status === 'arrived_at_pickup' ||
          order.status === 'pickup_verified') &&
        pickupCodes[order.id] === undefined
      ) {
        void getPickupCode(order.id).then((code) =>
          setPickupCodes((current) => ({ ...current, [order.id]: code })),
        )
      }
      if (
        (order.status === 'arrived_at_pickup' ||
          order.status === 'pickup_verified') &&
        riders[order.id] === undefined
      ) {
        void getRiderIdentity(order.id).then((identity) =>
          setRiders((current) => ({ ...current, [order.id]: identity })),
        )
      }
    }
  }, [orders, pickupCodes, riders])

  const handleSaveDetails = async () => {
    setDetailError(null)
    if (!detailName.trim()) {
      setDetailError('Business name is required.')
      return
    }
    if (!detailAddress.trim()) {
      setDetailError('Business address is required.')
      return
    }
    const phoneProblem = validateBusinessPhone(detailPhone)
    if (phoneProblem) {
      setDetailError(phoneProblem)
      return
    }
    setSavingDetails(true)
    const error = await saveBusinessDetails(
      user.id,
      detailName,
      detailAddress,
      detailPhone,
    )
    setSavingDetails(false)
    if (error) {
      setDetailError(error)
      return
    }
    await refreshProfile()
    notify('Business details saved.')
  }

  const handleSaveItem = async (
    input: ItemInput,
    newFiles: File[],
    removedImageIds: string[],
  ): Promise<string | null> => {
    if (itemModal?.mode === 'edit') {
      const editing = itemModal.item
      let error = await updateItem(editing.id, input)
      if (error) return error
      for (const imageId of removedImageIds) {
        const image = editing.images.find((candidate) => candidate.id === imageId)
        if (image) {
          error = await removeItemPhoto(image)
          if (error) return error
        }
      }
      if (newFiles.length > 0) {
        const remaining = editing.images.filter(
          (candidate) => !removedImageIds.includes(candidate.id),
        ).length
        error = await addItemPhotos(user.id, editing.id, remaining, newFiles)
        if (error) return error
      }
      notify('Item updated.')
      await refreshItems()
      return null
    }
    const error = await createItem(user.id, input, newFiles)
    if (error) return error
    notify('Product added.')
    await refreshItems()
    return null
  }

  const handleToggleAvailable = async (item: Item) => {
    setBusyItemId(item.id)
    const error = await setItemAvailability(item.id, !item.isAvailable)
    setBusyItemId(null)
    if (error) {
      notify('Could not update the product.', 'error')
      return
    }
    notify(item.isAvailable ? 'Product hidden from customers.' : 'Product is now available.')
    await refreshItems()
  }

  const handleDeleteItem = async (item: Item) => {
    const confirmed = window.confirm(
      `Delete "${item.name}"? Its photos will also be removed.`,
    )
    if (!confirmed) return
    setBusyItemId(item.id)
    const error = await deleteItem(item)
    setBusyItemId(null)
    if (error) {
      notify('Could not delete the product.', 'error')
      return
    }
    notify('Product deleted.')
    await refreshItems()
  }

  const handleConfirmRider = async (order: OrderReview) => {
    setConfirmingOrderId(order.id)
    const error = await businessConfirmRider(order.id)
    setConfirmingOrderId(null)
    if (error) {
      notify('Could not confirm the rider.', 'error')
      return
    }
    notify('Rider confirmed — the order is picked up.')
    await refreshOrders()
  }

  const myBoosts = boosts
    .filter((boost) => boost.ownerId === user.id)
    .slice()
    .sort(
      (a, b) => Number(a.status === 'active') - Number(b.status === 'active'),
    )

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
          <h1>Business dashboard</h1>
          <p>Your details, products and live orders in one place.</p>
        </div>

        {!detailsReady && (
          <div className="banner banner--warning">
            <IconBuilding size={20} className="banner__icon" />
            <div className="banner__body">
              <strong>Add your address and phone to start listing products</strong>
              <p>
                Customers see your business address and phone when they order
                from you, and the pickup code flow needs them.
              </p>
            </div>
          </div>
        )}

        <section className="section">
          <div className="section-head">
            <h2>Business details</h2>
            <p>Shown to customers when they select your business</p>
          </div>
          <div className="card details-card">
            <div className="form-grid form-grid--2">
              <div className="field">
                <label className="label" htmlFor="biz-name">
                  Business name
                </label>
                <input
                  id="biz-name"
                  className="input"
                  value={detailName}
                  onChange={(event) => setDetailName(event.target.value)}
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="biz-phone">
                  Business phone
                </label>
                <input
                  id="biz-phone"
                  className="input"
                  inputMode="tel"
                  placeholder="+234 800 000 0000"
                  value={detailPhone}
                  onChange={(event) => setDetailPhone(event.target.value)}
                />
              </div>
              <div className="field field--full">
                <label className="label" htmlFor="biz-address">
                  Business address
                </label>
                <input
                  id="biz-address"
                  className="input"
                  placeholder="e.g. 12 Adeniran Ogunsanya, Surulere"
                  value={detailAddress}
                  onChange={(event) => setDetailAddress(event.target.value)}
                />
              </div>
            </div>
            {detailError && <div className="auth__error">{detailError}</div>}
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={savingDetails}
                onClick={handleSaveDetails}
              >
                {savingDetails ? 'Saving…' : 'Save details'}
              </button>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>My products</h2>
            <p>Add, edit and toggle your products — no approval needed</p>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={!detailsReady}
              title={
                detailsReady
                  ? 'Add product'
                  : 'Add your address and phone first'
              }
              onClick={() => setItemModal({ mode: 'create' })}
            >
              <IconImage size={15} />
              Add product
            </button>
          </div>

          {itemsLoading ? (
            <div className="card empty-state">
              <span className="spinner" aria-hidden="true" />
              <p>Loading products…</p>
            </div>
          ) : itemsError ? (
            <div className="auth__error">{itemsError}</div>
          ) : items.length === 0 ? (
            <div className="card empty-state">
              <IconPackage size={26} />
              <p>No products yet — add your first product.</p>
            </div>
          ) : (
            <div className="items-grid">
              {items.map((item) => (
                <div className="card item-card" key={item.id}>
                  <div className="item-card__media">
                    {item.images[0]?.url ? (
                      <img src={item.images[0].url} alt={item.name} />
                    ) : null}
                  </div>
                  <div className="item-card__body">
                    <div className="item-card__head">
                      <h3>{item.name}</h3>
                      <span
                        className={`badge ${item.isAvailable ? 'badge--success' : 'badge--muted'}`}
                      >
                        {item.isAvailable ? 'Available' : 'Hidden'}
                      </span>
                    </div>
                    {item.description && (
                      <p className="item-card__desc">{item.description}</p>
                    )}
                    <div className="item-card__meta">
                      <span className="item-card__price">
                        {formatNgn(item.priceNaira)}
                        <small> · {item.quantity} in stock</small>
                      </span>
                    </div>
                    <div className="item-card__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busyItemId === item.id}
                        onClick={() => setItemModal({ mode: 'edit', item })}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busyItemId === item.id}
                        onClick={() => handleToggleAvailable(item)}
                      >
                        {item.isAvailable ? 'Hide' : 'Show'}
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busyItemId === item.id}
                        onClick={() => handleDeleteItem(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>New orders</h2>
            <p>Live — you are notified the moment a customer orders</p>
          </div>

          {ordersLoading ? (
            <div className="card empty-state">
              <span className="spinner" aria-hidden="true" />
              <p>Loading orders…</p>
            </div>
          ) : ordersError ? (
            <div className="auth__error">{ordersError}</div>
          ) : orders.length === 0 ? (
            <div className="card empty-state">
              <IconPackage size={26} />
              <p>No orders yet — customer orders appear here instantly.</p>
            </div>
          ) : (
            <div className="order-list">
              {orders.map((order) => (
                <div className="card order-card" key={order.id}>
                  <div className="order-card__head">
                    <span className="order-card__id">
                      <strong>{order.orderNumber}</strong>
                      <small>
                        {order.customerName}
                        {order.customerPhone ? ` · ${order.customerPhone}` : ''}{' '}
                        · {formatDateTime(order.createdAt)}
                      </small>
                    </span>
                    <span
                      className={`badge ${(ORDER_STATUS_META[order.status] ?? ORDER_STATUS_META.placed).badge}`}
                    >
                      {(ORDER_STATUS_META[order.status] ?? ORDER_STATUS_META.placed).label}
                    </span>
                  </div>

                  <div className="order-card__items">
                    {order.items.map((line) => (
                      <span key={line.id} className="order-card__item">
                        <strong>
                          {line.itemName} × {line.quantity}
                        </strong>
                        <span>{formatNgn(line.unitPriceNaira * line.quantity)}</span>
                      </span>
                    ))}
                    <span className="order-card__item order-card__item--total">
                      <strong>Total</strong>
                      <span>{formatNgn(order.totalNaira)}</span>
                    </span>
                  </div>

                  {order.deliveryAddress && (
                    <p className="order-card__address">
                      <IconTruck size={14} /> Deliver to:{' '}
                      {order.deliveryAddress.line1}, {order.deliveryAddress.city},{' '}
                      {order.deliveryAddress.state}
                    </p>
                  )}

                  {order.kind === 'shop' &&
                    (order.status === 'placed' ||
                      order.status === 'accepted_by_business' ||
                      order.status === 'ready_for_pickup') && (
                      <p className="meta-item meta-item--pending">
                        <IconClock size={14} /> Customer has not requested a
                        rider yet.
                      </p>
                    )}

                  {!order.businessAcceptedAt &&
                    (order.status === 'placed' ||
                      order.status === 'rider_requested' ||
                      order.status === 'rider_accepted') && (
                      <div className="confirm-box">
                        <span className="label">Accept order</span>
                        <div className="confirm-box__row">
                          <input
                            className="input"
                            inputMode="numeric"
                            placeholder="Prep time (minutes, optional)"
                            value={prepInputs[order.id] ?? ''}
                            onChange={(event) =>
                              setPrepInputs((current) => ({
                                ...current,
                                [order.id]: event.target.value.replace(/\D/g, ''),
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            disabled={acceptBusyId === order.id}
                            onClick={() => handleAcceptOrder(order)}
                          >
                            <IconCheckCircle size={15} />
                            {acceptBusyId === order.id
                              ? 'Accepting…'
                              : 'Accept order'}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={declineBusyId === order.id}
                          onClick={() => handleDecline(order)}
                        >
                          <IconXCircle size={15} />
                          Decline order
                        </button>
                      </div>
                    )}

                  {order.businessAcceptedAt &&
                    !order.readyAt &&
                    order.status !== 'cancelled' &&
                    order.status !== 'delivery_failed' &&
                    order.status !== 'arrived_at_pickup' &&
                    order.status !== 'pickup_verified' &&
                    order.status !== 'picked_up' &&
                    order.status !== 'arrived_at_destination' && (
                      <div className="confirm-box">
                        <span className="label">Preparation</span>
                        <p>
                          Order accepted
                          {order.prepMinutes
                            ? ` — estimated prep time ${order.prepMinutes} minutes`
                            : ''}
                          . Mark it ready when the order is packed.
                        </p>
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={readyBusyId === order.id}
                          onClick={() => handleMarkReady(order)}
                        >
                          <IconPackage size={15} />
                          {readyBusyId === order.id
                            ? 'Marking ready…'
                            : 'Order ready for pickup'}
                        </button>
                      </div>
                    )}

                  {(order.status === 'arrived_at_pickup' ||
                    order.status === 'pickup_verified') && (
                    <div className="confirm-box confirm-box--success">
                      <span className="label">Pickup verification</span>
                      <p>
                        The rider is at your business. Phone the customer and
                        give them this 6-digit pickup code:
                      </p>
                      <span className="otp-code">
                        {pickupCodes[order.id]
                          ? pickupCodes[order.id]!.replace(
                              /(\d{3})(\d{3})/,
                              '$1 $2',
                            )
                          : '——'}
                      </span>
                      {riders[order.id] && (
                        <div className="rider-identity">
                          <strong>
                            <IconTruck size={14} /> {riders[order.id]!.fullName}
                          </strong>
                          <span>
                            {riders[order.id]!.phone}
                            {riders[order.id]!.plateNumber
                              ? ` · ${riders[order.id]!.plateNumber}`
                              : ''}
                          </span>
                        </div>
                      )}
                      {order.waitingDeadline && (
                        <p>
                          <IconClock size={14} /> Customer not reachable —{' '}
                          {minutesLeft(order.waitingDeadline)} minute(s) left.
                        </p>
                      )}
                      <div className="form-actions">
                        <button
                          type="button"
                          className="btn btn--primary btn--sm"
                          disabled={confirmingOrderId === order.id}
                          onClick={() => handleConfirmRider(order)}
                        >
                          <IconCheckCircle size={15} />
                          Confirm this is the rider
                        </button>
                        {order.waitingDeadline && (
                          <>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={waitBusyId === order.id}
                              onClick={() => handleExtendWaiting(order)}
                            >
                              <IconClock size={15} />
                              Keep waiting (+5 min)
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={waitBusyId === order.id}
                              onClick={() => handleCancelWaiting(order)}
                            >
                              <IconXCircle size={15} />
                              Cancel order
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {order.status === 'arrived_at_destination' &&
                    order.waitingDeadline && (
                      <div className="confirm-box">
                        <span className="label">Customer not responding</span>
                        <p>
                          <IconClock size={14} /> The rider is waiting at the
                          customer&apos;s door —{' '}
                          {minutesLeft(order.waitingDeadline)} minute(s) before
                          the delivery can be reported failed.
                        </p>
                      </div>
                    )}

                  {order.status === 'delivered' && (
                    <div className="confirm-box confirm-box--done">
                      <IconCheckCircle size={18} />
                      Delivered — {order.orderNumber} is complete.
                    </div>
                  )}

                  {order.status === 'delivery_failed' && (
                    <div className="confirm-box confirm-box--failed">
                      <IconXCircle size={18} />
                      Delivery failed — the order is being returned to you
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
                      {(events[order.id] ?? []).map((event) => (
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
                      {(events[order.id] ?? []).length === 0 && (
                        <p className="notif-state">No events yet.</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Advertise &amp; boost</h2>
            <p>Promote listings and boost deliveries — pay via Flutterwave</p>
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
          onSuccess={(reference) => activateBoost(boostTarget, reference)}
        />
      )}

      {itemModal && (
        <ItemFormModal
          item={itemModal.mode === 'edit' ? itemModal.item : null}
          onClose={() => setItemModal(null)}
          onSave={handleSaveItem}
        />
      )}
    </div>
  )
}
