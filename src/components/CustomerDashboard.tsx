import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  BusinessProfile,
  CustomerOrder,
  User,
  UserRole,
} from '../types'
import type { ThemeMode } from '../utils/storage'
import { fetchCustomerOrders, expireStaleQuotes, subscribeCustomerOrders } from '../services/orders'
import { fetchBusinesses } from '../services/business'
import { subscribeNotifications } from '../services/notifications'
import { CustomerOrdersSection } from './CustomerOrdersSection'
import { CustomerShopSection } from './CustomerShopSection'
import { DashboardFooter } from './DashboardFooter'
import { DashboardHeader } from './DashboardHeader'
import { RiderRequestSection } from './RiderRequestSection'
import { IconPackage, IconStore, IconTruck } from './Icons'
import './../styles/dashboard.css'
import './../styles/customer.css'
import './../styles/flow.css'

interface CustomerDashboardProps {
  user: User
  theme: ThemeMode
  roles: UserRole[]
  activeRoleId: string | null
  onToggleTheme: () => void
  onLogout: () => void
  onSwitchRole: (roleId: string) => void
  onAddRole: () => void
  notify: (text: string, tone?: 'success' | 'error' | 'info') => void
}

type OrderMode = 'business' | 'rider'

export function CustomerDashboard({
  user,
  theme,
  roles,
  activeRoleId,
  onToggleTheme,
  onLogout,
  onSwitchRole,
  onAddRole,
  notify,
}: CustomerDashboardProps) {
  const [mode, setMode] = useState<OrderMode>('business')
  const [businesses, setBusinesses] = useState<BusinessProfile[]>([])
  const [businessId, setBusinessId] = useState('')
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [linkedOrderId, setLinkedOrderId] = useState<string | null>(null)
  const notifyRef = useRef(notify)

  useEffect(() => {
    notifyRef.current = notify
  }, [notify])

  const refreshOrders = useCallback(async () => {
    const result = await fetchCustomerOrders()
    setOrders(result.orders)
    setOrdersError(result.error)
  }, [])

  useEffect(() => {
    let active = true
    fetchCustomerOrders()
      .then((result) => {
        if (!active) return
        setOrders(result.orders)
        setOrdersError(result.error)
        setOrdersLoading(false)
      })
      .catch((cause) => {
        if (!active) return
        console.error('[customer] could not load orders:', cause)
        setOrdersError('Could not load your orders.')
        setOrdersLoading(false)
      })
    fetchBusinesses()
      .then((list) => {
        if (!active) return
        setBusinesses(list)
        setBusinessId((current) => current || list[0]?.userId || '')
      })
      .catch(() => {
        if (!active) return
        console.warn('[customer] could not load businesses')
      })
    return () => {
      active = false
    }
  }, [user.id])

  useEffect(() => {
    return subscribeNotifications(user.id, (notification) => {
      notifyRef.current(notification.title, 'info')
      void refreshOrders()
    })
  }, [user.id, refreshOrders])

  useEffect(() => {
    return subscribeCustomerOrders(user.id, () => void refreshOrders())
  }, [user.id, refreshOrders])

  useEffect(() => {
    const id = setInterval(() => {
      void expireStaleQuotes().then(() => refreshOrders())
    }, 30000)
    return () => clearInterval(id)
  }, [refreshOrders])

  const selectedBusiness =
    businesses.find((business) => business.userId === businessId) ?? null

  const switchMode = (next: OrderMode) => {
    setMode(next)
    setLinkedOrderId(null)
  }

  const handleRequestRider = (order: CustomerOrder) => {
    setMode('rider')
    setLinkedOrderId(order.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const linkedBusiness =
    linkedOrderId != null
      ? (businesses.find(
          (business) =>
            business.userId ===
            orders.find((order) => order.id === linkedOrderId)?.businessUserId,
        ) ?? null)
      : null

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
          <h1>Welcome back, {(user.fullName ?? '').split(' ')[0] || 'friend'}</h1>
          <p>Order from a business or just order a rider — your choice.</p>
        </div>

        <div className="choice-tabs" role="tablist" aria-label="Order type">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'business'}
            className={`choice-tabs__btn ${mode === 'business' ? 'choice-tabs__btn--active' : ''}`}
            onClick={() => switchMode('business')}
          >
            <IconStore size={16} />
            Order from a business
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'rider'}
            className={`choice-tabs__btn ${mode === 'rider' ? 'choice-tabs__btn--active' : ''}`}
            onClick={() => switchMode('rider')}
          >
            <IconTruck size={16} />
            Just order a rider
          </button>
        </div>

        {mode === 'business' && (
          <>
            <div className="card business-picker">
              <span className="label">Choose a business</span>
              <select
                className="input input--select"
                value={businessId}
                onChange={(event) => {
                  setBusinessId(event.target.value)
                  setLinkedOrderId(null)
                }}
                aria-label="Select business"
              >
                {businesses.length === 0 && (
                  <option value="">No businesses yet</option>
                )}
                {businesses.map((business) => (
                  <option value={business.userId} key={business.userId}>
                    {business.businessName}
                  </option>
                ))}
              </select>
            </div>

            {selectedBusiness ? (
              <CustomerShopSection
                user={user}
                business={selectedBusiness}
                onOrderPlaced={(orderId) => {
                  if (orderId) setLinkedOrderId(orderId)
                  void refreshOrders()
                }}
                notify={notify}
              />
            ) : (
              <div className="card empty-state">
                <IconPackage size={26} />
                <p>No businesses have registered yet — check back soon.</p>
              </div>
            )}
          </>
        )}

        {mode === 'rider' && (
          <RiderRequestSection
            user={user}
            linkedOrderId={linkedOrderId}
            linkedBusiness={linkedBusiness}
            onPlaced={() => {
              setLinkedOrderId(null)
              void refreshOrders()
            }}
            onCancelLinked={() => setLinkedOrderId(null)}
            notify={notify}
          />
        )}

        {linkedOrderId != null && mode === 'business' && (
            <div className="banner banner--success">
            <IconTruck size={20} className="banner__icon" />
            <div className="banner__body">
              <strong>Order placed — waiting for the business</strong>
              <p>
                The business must accept your order and give a preparation
                time. Once they do, the <strong>Request a rider</strong> button
                unlocks under My orders.
              </p>
            </div>
          </div>
        )}

        <CustomerOrdersSection
          orders={orders}
          loading={ordersLoading}
          error={ordersError}
          onRefresh={() => void refreshOrders()}
          onRequestRider={handleRequestRider}
          notify={notify}
        />
      </main>

      <DashboardFooter />
    </div>
  )
}
