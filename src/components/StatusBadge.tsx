import type { DeliveryStatus } from '../types'

const STATUS_META: Record<
  DeliveryStatus,
  { label: string; tone: 'muted' | 'info' | 'warning' | 'success' }
> = {
  pending_approval: { label: 'Pending approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'info' },
  assigned: { label: 'Assigned', tone: 'muted' },
  in_transit: { label: 'In transit', tone: 'info' },
  out_for_delivery: { label: 'Out for delivery', tone: 'warning' },
  awaiting_otp: { label: 'Awaiting OTP', tone: 'warning' },
  delivered: { label: 'Delivered', tone: 'success' },
}

interface StatusBadgeProps {
  status: DeliveryStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const meta = STATUS_META[status]
  if (!meta) return null
  return <span className={`badge badge--${meta.tone}`}>{meta.label}</span>
}
