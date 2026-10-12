import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AuthSession,
  BoostItem,
  Delivery,
  RegistrationInput,
  Role,
  ToastMessage,
  ToastTone,
  User,
} from './types'
import { usePersistentState } from './hooks/usePersistentState'
import { BusinessDashboard } from './components/BusinessDashboard'
import { CustomerDashboard } from './components/CustomerDashboard'
import { LandingPage } from './components/LandingPage'
import { LoginView } from './components/LoginView'
import { RiderDashboard } from './components/RiderDashboard'
import { Toast } from './components/Toast'
import {
  STORAGE_KEYS,
  clearSession,
  loadSession,
  loadTheme,
  saveSession,
  saveTheme,
} from './utils/storage'
import type { ThemeMode } from './utils/storage'

type View = 'landing' | 'login' | 'dashboard'

function App() {
  const [theme, setTheme] = useState<ThemeMode>(loadTheme)
  const [session, setSession] = useState<AuthSession | null>(loadSession)
  const [view, setView] = useState<View>(() =>
    loadSession() ? 'dashboard' : 'landing',
  )
  const [loginRole, setLoginRole] = useState<Role>('customer')
  const [toast, setToast] = useState<ToastMessage | null>(null)

  const [users, setUsers] = usePersistentState<User[]>(STORAGE_KEYS.users, [])
  const [deliveries, setDeliveries] = usePersistentState<Delivery[]>(
    STORAGE_KEYS.deliveries,
    [],
  )
  const [boosts, setBoosts] = usePersistentState<BoostItem[]>(
    STORAGE_KEYS.boosts,
    [],
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark-theme', theme === 'dark')
    saveTheme(theme)
  }, [theme])

  const notify = useCallback((text: string, tone: ToastTone = 'success') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  const updateDelivery = useCallback(
    (id: string, updater: (delivery: Delivery) => Delivery) => {
      setDeliveries((current) =>
        current.map((delivery) =>
          delivery.id === id ? updater(delivery) : delivery,
        ),
      )
    },
    [setDeliveries],
  )

  const addDelivery = useCallback(
    (delivery: Delivery) => {
      setDeliveries((current) => [delivery, ...current])
    },
    [setDeliveries],
  )

  const activateBoost = useCallback(
    (item: BoostItem, reference: string) => {
      const activeItem: BoostItem = { ...item, status: 'active' }
      setBoosts((current) => {
        const exists = current.some((boost) => boost.id === item.id)
        return exists
          ? current.map((boost) =>
              boost.id === item.id ? activeItem : boost,
            )
          : [...current, activeItem]
      })
      if (item.linkedDeliveryId) {
        updateDelivery(item.linkedDeliveryId, (current) => ({
          ...current,
          boosted: true,
        }))
      }
      notify(
        `Boost activated — ${item.title} is now live (ref ${reference}).`,
      )
    },
    [setBoosts, updateDelivery, notify],
  )

  const updateUser = useCallback(
    (id: string, updater: (user: User) => User) => {
      setUsers((current) =>
        current.map((user) => (user.id === id ? updater(user) : user)),
      )
    },
    [setUsers],
  )

  const handleSelectRole = (role: Role) => {
    setLoginRole(role)
    setView('login')
  }

  const handleLoginSuccess = (user: User, remembered: boolean) => {
    const nextSession: AuthSession = {
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      remembered,
      loginAt: new Date().toISOString(),
    }
    saveSession(nextSession, remembered)
    setSession(nextSession)
    setView('dashboard')
  }

  const handleRegister = (input: RegistrationInput): string | null => {
    const email = input.email.trim().toLowerCase()
    if (users.some((user) => user.email.toLowerCase() === email)) {
      return 'An account with this email already exists. Please sign in instead.'
    }
    const user: User = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fullName: input.fullName.trim(),
      email,
      password: input.password,
      phone: input.phone.trim(),
      role: input.role,
      ...(input.businessName?.trim()
        ? { businessName: input.businessName.trim() }
        : {}),
    }
    setUsers((current) => [...current, user])
    handleLoginSuccess(user, false)
    return null
  }

  const handleLogout = () => {
    clearSession()
    setSession(null)
    setView('landing')
  }

  const currentUser = session
    ? (users.find((user) => user.id === session.userId) ?? null)
    : null

  const effectiveView: View =
    view === 'dashboard' && (!session || !currentUser) ? 'landing' : view

  const availableRiders = useMemo(
    () =>
      users.filter(
        (user) => user.role === 'rider' && user.riderProfile?.clockedIn === true,
      ),
    [users],
  )

  return (
    <div className="app">
      {effectiveView === 'landing' && (
        <LandingPage
          theme={theme}
          onToggleTheme={() =>
            setTheme((value) => (value === 'dark' ? 'light' : 'dark'))
          }
          onSelectRole={handleSelectRole}
        />
      )}

      {effectiveView === 'login' && (
        <LoginView
          initialRole={loginRole}
          users={users}
          onBack={() => setView('landing')}
          onSuccess={handleLoginSuccess}
          onRegister={handleRegister}
        />
      )}

      {effectiveView === 'dashboard' && session && currentUser && (
        <>
          {currentUser.role === 'customer' && (
            <CustomerDashboard
              user={currentUser}
              deliveries={deliveries}
              theme={theme}
              onToggleTheme={() =>
                setTheme((value) => (value === 'dark' ? 'light' : 'dark'))
              }
              onLogout={handleLogout}
              addDelivery={addDelivery}
              updateDelivery={updateDelivery}
              updateUser={updateUser}
              notify={notify}
            />
          )}

          {currentUser.role === 'rider' && (
            <RiderDashboard
              user={currentUser}
              deliveries={deliveries}
              boosts={boosts}
              theme={theme}
              onToggleTheme={() =>
                setTheme((value) => (value === 'dark' ? 'light' : 'dark'))
              }
              onLogout={handleLogout}
              updateDelivery={updateDelivery}
              updateUser={updateUser}
              activateBoost={activateBoost}
              notify={notify}
            />
          )}

          {currentUser.role === 'business' && (
            <BusinessDashboard
              user={currentUser}
              deliveries={deliveries}
              boosts={boosts}
              riders={availableRiders}
              theme={theme}
              onToggleTheme={() =>
                setTheme((value) => (value === 'dark' ? 'light' : 'dark'))
              }
              onLogout={handleLogout}
              updateDelivery={updateDelivery}
              activateBoost={activateBoost}
              notify={notify}
            />
          )}
        </>
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

export default App
