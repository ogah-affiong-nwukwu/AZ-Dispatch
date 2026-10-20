import { Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import type { Role } from '../types'
import { normalizeRole, rolePathFor } from '../data/roles'

interface LoginRouteProps {
  authLoading: boolean
  session: Session | null
  currentRole: Role | null
}

export function LoginRoute({
  authLoading,
  session,
  currentRole,
}: LoginRouteProps) {
  if (authLoading) {
    return (
      <div className="app app-loading">
        <span className="spinner" aria-hidden="true" />
      </div>
    )
  }
  if (session) {
    if (currentRole) {
      return <Navigate to={rolePathFor(currentRole)} replace />
    }
    return <Navigate to="/" replace />
  }
  const urlRole =
    normalizeRole(new URLSearchParams(window.location.search).get('role')) ??
    'customer'
  return <Navigate to={`/?auth=signin&role=${urlRole}`} replace />
}
