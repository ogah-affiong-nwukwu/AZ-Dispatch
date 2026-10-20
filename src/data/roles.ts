import type { Role } from '../types'

export const ROLE_TABS: { role: Role; label: string }[] = [
  { role: 'customer', label: 'Customer' },
  { role: 'rider', label: 'Rider' },
  { role: 'business', label: 'Business' },
]

export const ROLE_LABELS: Record<Role, string> = {
  customer: 'Customer',
  rider: 'Dispatch Rider',
  business: 'Business',
}

export function normalizeRole(value: unknown): Role | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (
    normalized === 'customer' ||
    normalized === 'rider' ||
    normalized === 'business'
  ) {
    return normalized
  }
  return null
}

export function rolePathFor(role: Role): string {
  return {
    customer: '/customer',
    rider: '/rider',
    business: '/business',
  }[role]
}
