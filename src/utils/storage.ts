export const STORAGE_KEYS = {
  theme: 'az_dispatch_theme',
  activeRoleId: 'az_dispatch_active_role_id',
  deliveries: 'az_dispatch_deliveries_v3',
  boosts: 'az_dispatch_boosts_v3',
} as const

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

export function saveActiveRoleId(roleId: string): void {
  localStorage.setItem(STORAGE_KEYS.activeRoleId, roleId)
}

export function loadActiveRoleId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.activeRoleId)
}

export function clearActiveRoleId(): void {
  localStorage.removeItem(STORAGE_KEYS.activeRoleId)
}

export function resetDemoData(): void {
  localStorage.removeItem(STORAGE_KEYS.deliveries)
  localStorage.removeItem(STORAGE_KEYS.boosts)
}
