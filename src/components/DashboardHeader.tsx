import { useEffect, useState } from 'react'
import type { AppNotification, User, UserRole } from '../types'
import type { ThemeMode } from '../utils/storage'
import { ROLE_LABELS } from '../data/roles'
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  subscribeNotifications,
} from '../services/notifications'
import { formatDateTime } from '../utils/format'
import { Brand } from './Brand'
import { IconBell, IconLogOut } from './Icons'
import { ThemeToggle } from './ThemeToggle'

interface DashboardHeaderProps {
  user: User
  theme: ThemeMode
  roles: UserRole[]
  activeRoleId: string | null
  onToggleTheme: () => void
  onLogout: () => void
  onSwitchRole: (roleId: string) => void
  onAddRole: () => void
}

export function DashboardHeader({
  user,
  theme,
  roles,
  activeRoleId,
  onToggleTheme,
  onLogout,
  onSwitchRole,
  onAddRole,
}: DashboardHeaderProps) {
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [notifLoading, setNotifLoading] = useState(false)
  const [notifError, setNotifError] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)

  const initials = user.fullName
    .split(' ')
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const roleLabel = `${ROLE_LABELS[user.role]}${user.businessName ? ` · ${user.businessName}` : ''}`

  useEffect(() => {
    let active = true
    fetchUnreadCount(user.id).then((count) => {
      if (active) setUnread(count)
    })
    return () => {
      active = false
    }
  }, [user.id])

  useEffect(() => {
    return subscribeNotifications(user.id, (notification) => {
      setUnread((count) => count + 1)
      setNotifications((current) => [notification, ...current].slice(0, 20))
    })
  }, [user.id])

  const togglePanel = async () => {
    const next = !notifOpen
    setNotifOpen(next)
    if (!next) return
    setNotifLoading(true)
    setNotifError(null)
    try {
      setNotifications(await fetchNotifications(user.id))
    } catch {
      setNotifError('Could not load notifications.')
    } finally {
      setNotifLoading(false)
    }
  }

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead(user.id)
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, read: true })),
    )
    setUnread(0)
  }

  return (
    <header className="dash-header">
      <div className="dash-header__inner container">
        <Brand />
        <div className="dash-header__actions">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <div className="notif-wrap">
            <button
              type="button"
              className="notif-btn"
              onClick={() => void togglePanel()}
              aria-label="Notifications"
            >
              <IconBell size={17} />
              {unread > 0 && (
                <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>
              )}
            </button>
            {notifOpen && (
              <>
                <div
                  className="notif-backdrop"
                  onClick={() => setNotifOpen(false)}
                />
                <div className="notif-panel card">
                  <div className="notif-panel__head">
                    <strong>Notifications</strong>
                    {notifications.some((notification) => !notification.read) && (
                      <button
                        type="button"
                        className="notif-markall"
                        onClick={() => void handleMarkAllRead()}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  {notifLoading ? (
                    <div className="notif-state">
                      <span className="spinner" aria-hidden="true" />
                    </div>
                  ) : notifError ? (
                    <div className="notif-state">{notifError}</div>
                  ) : notifications.length === 0 ? (
                    <div className="notif-state">No notifications yet.</div>
                  ) : (
                    notifications.map((notification) => (
                      <div
                        className={`notif-item${notification.read ? '' : ' notif-item--unread'}`}
                        key={notification.id}
                      >
                        <strong>{notification.title}</strong>
                        <p>{notification.body}</p>
                        <small>{formatDateTime(notification.createdAt)}</small>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
          {roles.length > 1 && (
            <select
              className="role-switcher"
              aria-label="Switch account role"
              value={activeRoleId ?? ''}
              onChange={(event) => {
                const value = event.target.value
                if (value === '__add') {
                  onAddRole()
                } else {
                  onSwitchRole(value)
                }
              }}
            >
              {roles.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {ROLE_LABELS[candidate.roleType]}
                  {candidate.status === 'pending'
                    ? ' (pending)'
                    : candidate.status === 'rejected'
                      ? ' (rejected)'
                      : ''}
                </option>
              ))}
              <option value="__add">+ Add role</option>
            </select>
          )}
          <div className="user-chip">
            <span className="user-chip__avatar">{initials}</span>
            <span className="user-chip__meta">
              <strong>{user.fullName}</strong>
              <small>{roleLabel}</small>
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
