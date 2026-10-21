import type { OrderStatus } from '../types'

export interface OrderStatusMeta {
  label: string
  badge: string
  color: string
}

export const ORDER_STATUSES: OrderStatus[] = [
  'draft',
  'awaiting_payment',
  'payment_submitted',
  'payment_confirmed',
  'payment_rejected',
  'awaiting_business_approval',
  'awaiting_rider',
  'rider_assigned',
  'picked_up',
  'delivered',
  'delayed',
  'cancelled',
  'placed',
  'accepted_by_business',
  'ready_for_pickup',
  'rider_requested',
  'rider_quoted',
  'rider_accepted',
  'arrived_at_pickup',
  'pickup_verified',
  'arrived_at_destination',
  'delivery_failed',
]

export const ORDER_STATUS_META: Record<OrderStatus, OrderStatusMeta> = {
  draft: {
    label: 'Draft',
    badge: 'badge-pending',
    color: 'var(--status-pending)',
  },
  awaiting_payment: {
    label: 'Awaiting payment',
    badge: 'badge-pending',
    color: 'var(--status-pending)',
  },
  payment_submitted: {
    label: 'Payment submitted',
    badge: 'badge-pending',
    color: 'var(--status-pending)',
  },
  payment_confirmed: {
    label: 'Payment confirmed',
    badge: 'badge-assigned',
    color: 'var(--status-assigned)',
  },
  payment_rejected: {
    label: 'Payment rejected',
    badge: 'badge-delayed',
    color: 'var(--status-delayed)',
  },
  awaiting_business_approval: {
    label: 'Awaiting business approval',
    badge: 'badge-pending',
    color: 'var(--status-pending)',
  },
  awaiting_rider: {
    label: 'Awaiting rider',
    badge: 'badge-pending',
    color: 'var(--status-pending)',
  },
  rider_assigned: {
    label: 'Rider assigned',
    badge: 'badge-assigned',
    color: 'var(--status-assigned)',
  },
  picked_up: {
    label: 'Picked up',
    badge: 'badge-in-transit',
    color: 'var(--status-in-transit)',
  },
  delivered: {
    label: 'Delivered',
    badge: 'badge-delivered',
    color: 'var(--status-delivered)',
  },
  delayed: {
    label: 'Delayed',
    badge: 'badge-delayed',
    color: 'var(--status-delayed)',
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'badge-delayed',
    color: 'var(--status-delayed)',
  },
  placed: {
    label: 'Placed',
    badge: 'badge-pending',
    color: 'var(--status-pending)',
  },
  accepted_by_business: {
    label: 'Business accepted',
    badge: 'badge-assigned',
    color: 'var(--status-assigned)',
  },
  ready_for_pickup: {
    label: 'Ready for pickup',
    badge: 'badge-assigned',
    color: 'var(--status-assigned)',
  },
  rider_requested: {
    label: 'Rider requested',
    badge: 'badge-pending',
    color: 'var(--status-pending)',
  },
  rider_quoted: {
    label: 'Rider quoted',
    badge: 'badge-pending',
    color: 'var(--status-pending)',
  },
  rider_accepted: {
    label: 'Rider accepted',
    badge: 'badge-assigned',
    color: 'var(--status-assigned)',
  },
  arrived_at_pickup: {
    label: 'Rider at pickup',
    badge: 'badge-in-transit',
    color: 'var(--status-in-transit)',
  },
  pickup_verified: {
    label: 'Pickup verified',
    badge: 'badge-in-transit',
    color: 'var(--status-in-transit)',
  },
  arrived_at_destination: {
    label: 'At destination',
    badge: 'badge-in-transit',
    color: 'var(--status-in-transit)',
  },
  delivery_failed: {
    label: 'Delivery failed',
    badge: 'badge-delayed',
    color: 'var(--status-delayed)',
  },
}

export const ORDER_FLOW_STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'placed', label: 'Order placed' },
  { status: 'accepted_by_business', label: 'Business accepted' },
  { status: 'ready_for_pickup', label: 'Ready for pickup' },
  { status: 'rider_requested', label: 'Rider requested' },
  { status: 'rider_quoted', label: 'Rider quoted' },
  { status: 'rider_accepted', label: 'Rider accepted' },
  { status: 'arrived_at_pickup', label: 'At pickup' },
  { status: 'pickup_verified', label: 'Pickup verified' },
  { status: 'picked_up', label: 'Picked up' },
  { status: 'arrived_at_destination', label: 'At destination' },
  { status: 'delivered', label: 'Delivered' },
]

export function flowStepIndex(status: OrderStatus): number {
  const index = ORDER_FLOW_STEPS.findIndex((step) => step.status === status)
  return index === -1 ? 0 : index
}
