import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import type {
  BoostItem,
  RegistrationInput,
  Role,
  ToastMessage,
  ToastTone,
  User,
  UserRole,
} from './types'
import { usePersistentState } from './hooks/usePersistentState'
import { AuthModal } from './components/AuthModal'
import { LandingPage } from './components/LandingPage'
import { LoginRoute } from './pages/Login'
import { ProtectedRoute } from './components/ProtectedRoute'
import { SupabaseSetupNotice } from './components/SupabaseSetupNotice'
import { Toast } from './components/Toast'
import { normalizeRole, rolePathFor, ROLE_LABELS } from './data/roles'
import { isSupabaseConfigured, requireSupabase } from './lib/supabase'
import {
  addRole,
  ensureProfile,
  ensureRole,
  fetchProfile,
  fetchRoles,
  registerWithPassword,
  signInWithEmail,
  signOut,
  type AuthResult,
  type Profile,
  type SignInResult,
} from './services/auth'
import {
  STORAGE_KEYS,
  clearActiveRoleId,
  loadActiveRoleId,
  loadTheme,
  saveActiveRoleId,
  saveTheme,
} from './utils/storage'
import type { ThemeMode } from './utils/storage'

const BusinessDashboard = lazy(() =>
  import('./components/BusinessDashboard').then((module) => ({
    default: module.BusinessDashboard,
  })),
)
const CustomerDashboard = lazy(() =>
  import('./components/CustomerDashboard').then((module) => ({
    default: module.CustomerDashboard,
  })),
)
const MembershipStatusScreen = lazy(() =>
  import('./components/MembershipStatusScreen').then((module) => ({
    default: module.MembershipStatusScreen,
  })),
)
const RiderDashboard = lazy(() =>
  import('./components/RiderDashboard').then((module) => ({
    default: module.RiderDashboard,
  })),
)

interface AuthModalState {
  open: boolean
  role: Role
  context: 'login' | 'add-role'
  mode: 'signin' | 'register'
}

function readAuthFromUrl(search: string): AuthModalState {
  const params = new URLSearchParams(search)
  const auth = params.get('auth')
  if (auth !== 'signin' && auth !== 'register' && auth !== 'addrole') {
    return { open: false, role: 'customer', context: 'login', mode: 'signin' }
  }
  const role: Role = normalizeRole(params.get('role')) ?? 'customer'
  return {
    open: true,
    role,
    context: auth === 'addrole' ? 'add-role' : 'login',
    mode: auth === 'register' ? 'register' : 'signin',
  }
}

function roleFromPath(pathname: string): Role | null {
  if (pathname === '/customer') return 'customer'
  if (pathname === '/rider') return 'rider'
  if (pathname === '/business') return 'business'
  return null
}

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const [theme, setTheme] = useState<ThemeMode>(loadTheme)
  const [authLoading, setAuthLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<UserRole[]>([])
  const [activeRoleId, setActiveRoleId] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  const authModal = readAuthFromUrl(location.search)

  const [boosts, setBoosts] = usePersistentState<BoostItem[]>(
    STORAGE_KEYS.boosts,
    [],
  )

  const applySessionData = useCallback(async (userId: string) => {
    const [nextProfile, nextRoles] = await Promise.all([
      fetchProfile(userId),
      fetchRoles(userId),
    ])
    setProfile(nextProfile)
    setRoles(nextRoles)
    const active =
      nextRoles.find((candidate) => candidate.id === loadActiveRoleId()) ??
      nextRoles.find((candidate) => candidate.status === 'active') ??
      nextRoles[0] ??
      null
    setActiveRoleId(active?.id ?? null)
    if (active) saveActiveRoleId(active.id)
    return { profile: nextProfile, roles: nextRoles, active }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let mounted = true
    const supabase = requireSupabase()
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session) {
        void applySessionData(data.session.user.id).finally(() => {
          if (mounted) setAuthLoading(false)
        })
      } else {
        setAuthLoading(false)
      }
    })
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!mounted) return
        setSession(nextSession)
        if (nextSession) {
          void applySessionData(nextSession.user.id)
        } else {
          setProfile(null)
          setRoles([])
          setActiveRoleId(null)
          clearActiveRoleId()
        }
      },
    )
    return () => {
      mounted = false
      listener?.subscription.unsubscribe()
    }
  }, [applySessionData])

  useEffect(() => {
    document.documentElement.classList.toggle('dark-theme', theme === 'dark')
    saveTheme(theme)
  }, [theme])

  const notify = useCallback((text: string, tone: ToastTone = 'success') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  const openAuth = useCallback(
    (role: Role, context: 'login' | 'add-role') => {
      const auth = context === 'add-role' ? 'addrole' : 'signin'
      navigate(`${window.location.pathname}?auth=${auth}&role=${role}`)
    },
    [navigate],
  )

  const closeAuth = useCallback(() => {
    const next = new URL(window.location.href)
    next.searchParams.delete('auth')
    next.searchParams.delete('role')
    next.searchParams.delete('mode')
    navigate(`${next.pathname}${next.search}`, { replace: true })
  }, [navigate])

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
      notify(
        `Boost activated — ${item.title} is now live (ref ${reference}).`,
      )
    },
    [setBoosts, notify],
  )

  const handleSelectRole = useCallback(
    (role: Role) => {
      openAuth(role, 'login')
    },
    [openAuth],
  )

  const handleAddRoleRequest = useCallback(() => {
    openAuth('customer', 'add-role')
  }, [openAuth])

  const handleSignIn = useCallback(
    async (
      email: string,
      password: string,
      role: Role,
    ): Promise<SignInResult | null> => {
      console.log('[auth] handleSignIn start:', { email, role })
      const error = await signInWithEmail(email, password)
      if (error) {
        console.log('[auth] handleSignIn — signInWithEmail error:', error)
        return { error }
      }
      const { data } = await requireSupabase().auth.getSession()
      console.log('[auth] handleSignIn — session:', {
        present: Boolean(data.session),
        userId: data.session?.user.id ?? null,
      })
      if (!data.session) {
        console.error('[auth] sign-in succeeded but no session was returned.')
        return {
          error:
            'Sign-in did not complete — no session was created. Check the Supabase email confirmation settings and try again.',
        }
      }
      const userId = data.session.user.id
      let result = await applySessionData(userId)
      console.log('[auth] handleSignIn — loaded:', {
        profile: Boolean(result.profile),
        roles: result.roles.map((candidate) => candidate.roleType),
      })
      if (!result.profile) {
        console.warn('[auth] handleSignIn — profile missing, self-healing…')
        const healedProfile = await ensureProfile()
        console.log(
          '[auth] handleSignIn — ensure_profile healed:',
          Boolean(healedProfile),
        )
        if (healedProfile) result = await applySessionData(userId)
      }
      if (!result.profile) {
        console.error(
          '[auth] handleSignIn — profile still missing. Is the profiles table created (migration 0001)?',
        )
        return {
          error:
            'Signed in, but your account profile could not be loaded. Run the Supabase migrations (see supabase/migrations) and try again.',
        }
      }
      if (result.roles.length === 0) {
        console.warn(
          `[auth] handleSignIn — no role rows, self-healing with the picked role "${role}"…`,
        )
        await ensureRole(userId, role)
        result = await applySessionData(userId)
      }
      const holdsPickedRole = result.roles.some(
        (candidate) =>
          candidate.roleType === role && candidate.status === 'active',
      )
      if (!holdsPickedRole) {
        console.log(
          `[auth] handleSignIn — user does not have the "${role}" role yet, asking to set one up`,
        )
        return { missingRole: role }
      }
      const pickedRole = result.roles.find(
        (candidate) =>
          candidate.roleType === role && candidate.status === 'active',
      )
      if (pickedRole) {
        setActiveRoleId(pickedRole.id)
        saveActiveRoleId(pickedRole.id)
      }
      const target = rolePathFor(role)
      console.log('[auth] handleSignIn — navigate:', { role, target })
      navigate(target)
      return null
    },
    [applySessionData, navigate],
  )

  const handleRegister = useCallback(
    async (input: RegistrationInput): Promise<AuthResult | null> => {
      console.log('[auth] handleRegister start:', { role: input.role })
      const result = await registerWithPassword(input)
      if (result) return result
      const { data } = await requireSupabase().auth.getSession()
      console.log('[auth] handleRegister — session:', {
        present: Boolean(data.session),
        userId: data.session?.user.id ?? null,
      })
      if (!data.session) {
        console.error(
          '[auth] registration succeeded but no session was returned.',
        )
        return {
          error:
            'Registration did not complete — no session was created. Check the Supabase email confirmation settings and try again.',
        }
      }
      const userId = data.session.user.id
      let sessionResult = await applySessionData(userId)
      console.log('[auth] handleRegister — loaded:', {
        profile: Boolean(sessionResult.profile),
        roles: sessionResult.roles.map((candidate) => candidate.roleType),
      })
      if (!sessionResult.profile) {
        console.warn('[auth] handleRegister — profile missing, self-healing…')
        const healedProfile = await ensureProfile()
        console.log(
          '[auth] handleRegister — ensure_profile healed:',
          Boolean(healedProfile),
        )
        if (healedProfile) sessionResult = await applySessionData(userId)
      }
      if (!sessionResult.profile) {
        console.error(
          '[auth] handleRegister — profile still missing. Is the profiles table created (migration 0001)?',
        )
        return {
          error:
            'Account created, but your profile could not be loaded. Run the Supabase migrations (see supabase/migrations) and try again.',
        }
      }
      if (!sessionResult.roles.some((candidate) => candidate.roleType === input.role)) {
        console.warn(
          `[auth] handleRegister — "${input.role}" role missing, self-healing…`,
        )
        await ensureRole(userId, input.role)
        sessionResult = await applySessionData(userId)
      }
      const pickedRole = sessionResult.roles.find(
        (candidate) =>
          candidate.roleType === input.role && candidate.status === 'active',
      )
      if (pickedRole) {
        setActiveRoleId(pickedRole.id)
        saveActiveRoleId(pickedRole.id)
      }
      const target = rolePathFor(input.role)
      console.log('[auth] handleRegister — navigate:', {
        role: input.role,
        target,
      })
      navigate(target)
      return null
    },
    [applySessionData, navigate],
  )

  const handleAddRole = useCallback(
    async (
      role: Role,
      options: {
        businessName?: string
        businessAddress?: string
        businessPhone?: string
        vehicleType?: string
        plateNumber?: string
        zone?: string
      } = {},
    ): Promise<string | null> => {
      if (!profile) return 'You must be signed in to add a role.'
      console.log('[auth] handleAddRole start:', { role })
      const error = await addRole(profile.id, role, options)
      if (error) return error
      const [nextProfile, nextRoles] = await Promise.all([
        fetchProfile(profile.id),
        fetchRoles(profile.id),
      ])
      setProfile(nextProfile)
      setRoles(nextRoles)
      const added = nextRoles.find((candidate) => candidate.roleType === role)
      if (added) {
        setActiveRoleId(added.id)
        saveActiveRoleId(added.id)
      }
      console.log('[auth] handleAddRole — navigate:', rolePathFor(role))
      navigate(rolePathFor(role))
      return null
    },
    [profile, navigate],
  )

  const handleLogout = useCallback(async () => {
    await signOut()
    setSession(null)
    setProfile(null)
    setRoles([])
    setActiveRoleId(null)
    clearActiveRoleId()
    navigate('/')
  }, [navigate])

  const handleSwitchRole = useCallback(
    (roleId: string) => {
      const target = roles.find((candidate) => candidate.id === roleId)
      if (!target) return
      setActiveRoleId(target.id)
      saveActiveRoleId(target.id)
      navigate(rolePathFor(target.roleType))
      notify(`Switched to your ${ROLE_LABELS[target.roleType]} account.`)
    },
    [roles, notify, navigate],
  )

  const routeRole = roleFromPath(location.pathname)

  const activeRole = useMemo(
    () =>
      (routeRole
        ? roles.find(
            (candidate) =>
              candidate.roleType === routeRole && candidate.status === 'active',
          )
        : null) ??
      roles.find((candidate) => candidate.id === activeRoleId) ??
      null,
    [routeRole, roles, activeRoleId],
  )

  const currentUser: User | null =
    profile && session && activeRole
      ? {
          id: profile.id,
          fullName: profile.fullName,
          email: session.user.email ?? '',
          phone: profile.phone ?? '',
          role: activeRole.roleType,
          businessName: profile.businessName ?? undefined,
          defaultAddress: profile.defaultAddress ?? undefined,
          riderProfile: profile.riderProfile ?? undefined,
        }
      : null

  if (!isSupabaseConfigured) {
    return <SupabaseSetupNotice />
  }

  if (authLoading) {
    return (
      <div className="app app-loading">
        <span className="spinner" aria-hidden="true" />
      </div>
    )
  }

  const spinnerFallback = (
    <div className="app app-loading">
      <span className="spinner" aria-hidden="true" />
    </div>
  )

  const themeProps = {
    theme,
    onToggleTheme: () =>
      setTheme((value) => (value === 'dark' ? 'light' : 'dark')),
  }

  const chromeProps = {
    roles,
    activeRoleId: activeRole?.id ?? null,
    onLogout: handleLogout,
    onSwitchRole: handleSwitchRole,
    onAddRole: handleAddRoleRequest,
  }

  return (
    <div className="app">
      <Routes>
        <Route
          path="/"
          element={
            <LandingPage
              theme={theme}
              onToggleTheme={() =>
                setTheme((value) => (value === 'dark' ? 'light' : 'dark'))
              }
              onSelectRole={handleSelectRole}
            />
          }
        />

        <Route
          path="/login"
          element={
            <LoginRoute
              authLoading={authLoading}
              session={session}
              currentRole={activeRole?.roleType ?? null}
            />
          }
        />

        <Route
          path="/customer"
          element={
            <ProtectedRoute
              authLoading={authLoading}
              session={session}
              currentUser={currentUser}
              roles={roles}
              requiredRole="customer"
            >
              {currentUser && (
                <Suspense fallback={spinnerFallback}>
                  <CustomerDashboard
                    user={currentUser}
                    {...themeProps}
                    {...chromeProps}
                    notify={notify}
                  />
                </Suspense>
              )}
            </ProtectedRoute>
          }
        />

        <Route
          path="/business"
          element={
            <ProtectedRoute
              authLoading={authLoading}
              session={session}
              currentUser={currentUser}
              roles={roles}
              requiredRole="business"
            >
              {currentUser && activeRole && (
                <Suspense fallback={spinnerFallback}>
                  {activeRole.status === 'active' ? (
                    <BusinessDashboard
                      user={currentUser}
                      boosts={boosts}
                      {...themeProps}
                      {...chromeProps}
                      activateBoost={activateBoost}
                      notify={notify}
                    />
                  ) : (
                    <MembershipStatusScreen
                      user={currentUser}
                      role={activeRole}
                      {...themeProps}
                      {...chromeProps}
                    />
                  )}
                </Suspense>
              )}
            </ProtectedRoute>
          }
        />

        <Route
          path="/rider"
          element={
            <ProtectedRoute
              authLoading={authLoading}
              session={session}
              currentUser={currentUser}
              roles={roles}
              requiredRole="rider"
            >
              {currentUser && activeRole && (
                <Suspense fallback={spinnerFallback}>
                  {activeRole.status === 'active' ? (
                    <RiderDashboard
                      user={currentUser}
                      {...themeProps}
                      {...chromeProps}
                      notify={notify}
                    />
                  ) : (
                    <MembershipStatusScreen
                      user={currentUser}
                      role={activeRole}
                      {...themeProps}
                      {...chromeProps}
                    />
                  )}
                </Suspense>
              )}
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {authModal.open && (
        <AuthModal
          initialRole={authModal.role}
          initialMode={authModal.mode}
          signedIn={authModal.context === 'add-role' && Boolean(session)}
          signedInEmail={session?.user.email ?? null}
          onClose={closeAuth}
          onSignIn={handleSignIn}
          onRegister={handleRegister}
          onAddRole={handleAddRole}
        />
      )}

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}

export default App
