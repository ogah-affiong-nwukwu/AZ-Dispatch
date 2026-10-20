import type { DeliveryStatus } from '../types'

const STATUS_META: Record<
  DeliveryStatus,
  { label: string; tone: string }
> = {
  pending_approval: { label: 'Pending approval', tone: 'badge-pending' },
  approved: { label: 'Approved', tone: 'badge-assigned' },
  assigned: { label: 'Assigned', tone: 'badge-assigned' },
  in_transit: { label: 'In transit', tone: 'badge-in-transit' },
  out_for_delivery: { label: 'Out for delivery', tone: 'badge-in-transit' },
  awaiting_otp: { label: 'Awaiting OTP', tone: 'badge-pending' },
  delivered: { label: 'Delivered', tone: 'badge-delivered' },
}

interface StatusBadgeProps {
  status: DeliveryStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const meta = STATUS_META[status]
  if (!meta) return null
  return <span className={`badge ${meta.tone}`}>{meta.label}</span>
}
