import { requireSupabase } from '../lib/supabase'
import type { Address, DeliveryState, OrderStatus, RiderJob } from '../types'
import { fetchCompanies } from './company'

interface JobOrderRow {
  id: string
  order_number: string
  status: OrderStatus
  kind: 'shop' | 'rider_only'
  delivery_fee_naira: number
  item_description: string | null
  pickup_address: Address | null
  delivery_address: Address | null
  company_id: string | null
  created_at: string
  order_items: { item_name: string; quantity: number }[]
}

interface DeliveryRow {
  id: string
  order_id: string
  status: DeliveryState
}

async function buildJobs(
  orders: JobOrderRow[],
  deliveryByOrder: Map<string, DeliveryRow> | null,
): Promise<RiderJob[]> {
  const companies = await fetchCompanies()
  const companyById = new Map(companies.map((company) => [company.id, company]))
  return orders.map((order) => {
    const company = order.company_id
      ? (companyById.get(order.company_id) ?? null)
      : null
    const pickup = order.pickup_address
    const dropOff = order.delivery_address
    const itemSummary =
      order.kind === 'rider_only'
        ? (order.item_description ?? '')
        : (order.order_items ?? [])
            .map((line) => `${line.item_name} × ${line.quantity}`)
            .join(', ')
    const delivery = deliveryByOrder?.get(order.id) ?? null
    return {
      deliveryId: delivery?.id ?? null,
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      deliveryStatus: delivery?.status ?? null,
      companyName: company?.name ?? 'Dispatch company',
      pickupLabel: pickup?.city
        ? `${pickup.city}, ${pickup.state}`
        : company
          ? `${company.city}, ${company.state}`
          : 'Company hub',
      dropOffLabel: dropOff
        ? dropOff.city
          ? `${dropOff.city}, ${dropOff.state}`
          : (dropOff.label ?? '—')
        : '—',
      feeNaira: order.delivery_fee_naira,
      itemSummary,
      createdAt: order.created_at,
    }
  })
}

export async function fetchAvailableJobs(): Promise<RiderJob[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(item_name, quantity)')
    .eq('status', 'awaiting_rider')
    .order('created_at', { ascending: true })
  if (error || !data) return []
  return buildJobs(data as unknown as JobOrderRow[], null)
}

export async function fetchMyJobs(riderUserId: string): Promise<RiderJob[]> {
  const supabase = requireSupabase()
  const { data: deliveries, error } = await supabase
    .from('deliveries')
    .select('*')
    .eq('rider_user_id', riderUserId)
    .order('created_at', { ascending: false })
  if (error || !deliveries) return []
  const deliveryRows = deliveries as unknown as DeliveryRow[]
  const orderIds = deliveryRows.map((delivery) => delivery.order_id)
  if (orderIds.length === 0) return []
  const { data: orders } = await supabase
    .from('orders')
    .select('*, order_items(item_name, quantity)')
    .in('id', orderIds)
  if (!orders) return []
  const deliveryByOrder = new Map(
    deliveryRows.map((delivery) => [delivery.order_id, delivery]),
  )
  return buildJobs(orders as unknown as JobOrderRow[], deliveryByOrder)
}

function mapDeliveryError(message: string): string {
  if (message.includes('ORDER_NOT_AVAILABLE')) {
    return 'This job is no longer available.'
  }
  if (message.includes('ORDER_ALREADY_ACCEPTED')) {
    return 'Another rider already accepted this job.'
  }
  if (message.includes('FORBIDDEN')) {
    return 'Only an approved rider of this company can accept the job.'
  }
  if (message.includes('NOT_AUTHENTICATED')) {
    return 'You must be signed in to continue.'
  }
  return message
}

export async function acceptDelivery(
  orderId: string,
): Promise<{ code?: string; error?: string }> {
  const { data, error } = await requireSupabase().rpc('accept_delivery', {
    p_order_id: orderId,
  })
  if (error) return { error: mapDeliveryError(error.message) }
  return { code: data as string }
}

export async function markPickedUp(deliveryId: string): Promise<string | null> {
  const { error } = await requireSupabase().rpc('mark_delivery_picked_up', {
    p_delivery_id: deliveryId,
  })
  return error ? error.message : null
}

export async function markDeliveredPendingCode(
  deliveryId: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('mark_delivery_pending_code', {
    p_delivery_id: deliveryId,
  })
  return error ? error.message : null
}
