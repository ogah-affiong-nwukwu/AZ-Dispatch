import type { User } from '../types'
import type { ThemeMode } from '../utils/storage'
import { Brand } from './Brand'
import { IconLogOut } from './Icons'
import { ThemeToggle } from './ThemeToggle'

interface DashboardHeaderProps {
  user: User
  theme: ThemeMode
  onToggleTheme: () => void
  onLogout: () => void
}

export function DashboardHeader({
  user,
  theme,
  onToggleTheme,
  onLogout,
}: DashboardHeaderProps) {
  const initials = user.fullName
    .split(' ')
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const roleLabel =
    user.role === 'business'
      ? 'Business account'
      : user.role === 'rider'
        ? 'Dispatch Rider'
        : 'Customer'

  return (
    <header className="dash-header">
      <div className="dash-header__inner container">
        <Brand />
        <div className="dash-header__actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <div className="user-chip">
            <span className="user-chip__avatar">{initials}</span>
            <span className="user-chip__meta">
              <strong>{user.fullName}</strong>
              <small>
                {roleLabel}
                {user.businessName ? ` · ${user.businessName}` : ''}
              </small>
            </span>
          </div>
          <button
            type="button"
            className="btn btn--ghost btn--sm dash-logout"
            onClick={onLogout}
          >
            <IconLogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </header>
  )
}
