import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import type { Role, User, UserRole } from '../types'

interface ProtectedRouteProps {
  authLoading: boolean
  session: Session | null
  currentUser: User | null
  roles: UserRole[]
  requiredRole: Role
  children: ReactNode
}

export function ProtectedRoute({
  authLoading,
  session,
  currentUser,
  roles,
  requiredRole,
  children,
}: ProtectedRouteProps) {
  if (authLoading) {
    return (
      <div className="app app-loading">
        <span className="spinner" aria-hidden="true" />
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace />
  }
  if (!currentUser) {
    return <Navigate to="/" replace />
  }
  const holdsRole = roles.some(
    (candidate) =>
      candidate.roleType === requiredRole && candidate.status === 'active',
  )
  if (!holdsRole) {
    const registrationTarget = session
      ? `/?auth=addrole&role=${requiredRole}`
      : `/login?role=${requiredRole}`
    return <Navigate to={registrationTarget} replace />
  }
  if (currentUser.role !== requiredRole) {
    return (
      <div className="app app-loading">
        <span className="spinner" aria-hidden="true" />
      </div>
    )
  }
  return <>{children}</>
}
