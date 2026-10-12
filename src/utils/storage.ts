import type { AuthSession } from '../types'

export const STORAGE_KEYS = {
  session: 'az_dispatch_session',
  theme: 'az_dispatch_theme',
  users: 'az_dispatch_users_v3',
  deliveries: 'az_dispatch_deliveries_v3',
  boosts: 'az_dispatch_boosts_v3',
} as const

export function saveSession(session: AuthSession, remember: boolean): void {
  const primary = remember ? localStorage : sessionStorage
  const secondary = remember ? sessionStorage : localStorage
  secondary.removeItem(STORAGE_KEYS.session)
  primary.setItem(
    STORAGE_KEYS.session,
    JSON.stringify({ ...session, remembered: remember }),
  )
}

export function loadSession(): AuthSession | null {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEYS.session) ??
      sessionStorage.getItem(STORAGE_KEYS.session)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthSession
    if (!parsed?.userId || !parsed?.role) return null
    return parsed
  } catch {
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEYS.session)
  sessionStorage.removeItem(STORAGE_KEYS.session)
}

export type ThemeMode = 'light' | 'dark'

export function loadTheme(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEYS.theme)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function saveTheme(theme: ThemeMode): void {
  localStorage.setItem(STORAGE_KEYS.theme, theme)
}

export function resetDemoData(): void {
  localStorage.removeItem(STORAGE_KEYS.users)
  localStorage.removeItem(STORAGE_KEYS.deliveries)
  localStorage.removeItem(STORAGE_KEYS.boosts)
}
