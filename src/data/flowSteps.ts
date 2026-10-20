import type { CustomerOrder, OrderStatus } from '../types'
import { ORDER_FLOW_STEPS } from './orderStatuses'

export interface StepState {
  status: OrderStatus
  label: string
  state: 'done' | 'current' | 'pending'
}

export function stepStates(order: CustomerOrder): StepState[] {
  const isRiderOnly = order.kind === 'rider_only'
  const statusIdx = ORDER_FLOW_STEPS.findIndex(
    (step) => step.status === order.status,
  )
  const currentIndex = statusIdx === -1 ? null : statusIdx
  const terminal = order.status === 'delivered'

  return ORDER_FLOW_STEPS.map((step, index) => {
    let done: boolean
    if (step.status === 'placed') {
      done = true
    } else if (step.status === 'accepted_by_business') {
      done = Boolean(order.businessAcceptedAt)
    } else if (step.status === 'ready_for_pickup') {
      done = isRiderOnly || Boolean(order.readyAt)
    } else if (step.status === 'rider_requested') {
      done = isRiderOnly || Boolean(order.riderRequestedAt)
    } else if (step.status === 'rider_accepted') {
      done = Boolean(order.delivery)
    } else if (step.status === 'arrived_at_pickup' || step.status === 'pickup_verified') {
      done = isRiderOnly ? currentIndex !== null && currentIndex > 6 : currentIndex !== null && currentIndex > index
    } else {
      done = currentIndex !== null && currentIndex > index
    }
    if (currentIndex !== null && index < currentIndex) done = true

    let state: StepState['state'] = done ? 'done' : 'pending'
    if (!terminal && currentIndex === index) state = 'current'
    return { status: step.status, label: step.label, state }
  })
}

export const EVENT_LABELS: Record<string, string> = {
  order_placed: 'Order placed',
  business_accepted: 'Business accepted the order',
  business_declined: 'Business declined the order',
  order_ready: 'Business marked the order ready',
  rider_requested: 'Customer requested a rider',
  reminder_sent: 'Rider request reminder sent',
  no_rider_timeout: 'No rider accepted within the time limit',
  rider_accepted: 'Rider accepted the job',
  arrived_pickup: 'Rider arrived at pickup',
  customer_not_reachable: 'Customer not reachable at pickup',
  waiting_extended: 'Waiting time extended',
  pickup_code_failed: 'Pickup code attempt failed',
  pickup_code_verified: 'Pickup code verified',
  rider_confirmed: 'Business confirmed the rider',
  picked_up: 'Order picked up',
  arrived_destination: 'Rider arrived at destination',
  customer_not_responding: 'Customer not responding at destination',
  delivery_code_failed: 'Delivery code attempt failed',
  delivery_code_verified: 'Delivery code verified',
  delivered: 'Order delivered',
  order_cancelled: 'Order cancelled',
  delivery_failed: 'Delivery failed — order returned to the business',
}
