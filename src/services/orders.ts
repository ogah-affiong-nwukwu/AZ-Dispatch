import { requireSupabase } from '../lib/supabase'
import type {
  Address,
  CustomerDeliveryState,
  CustomerOrder,
  CustomerOrderItem,
  CustomerPayment,
  OrderEvent,
  OrderProgress,
  OrderStatus,
  RiderIdentity,
  ShopItem,
} from '../types'
import { mapImage, mapItem } from './items'
import { fetchCompanies } from './company'

export const MAX_SLIP_BYTES = 5 * 1024 * 1024
const ALLOWED_SLIP_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]

export function validateSlipFile(file: File): string | null {
  if (!ALLOWED_SLIP_TYPES.includes(file.type)) {
    return 'The payment slip must be an image (JPG, PNG, WebP) or a PDF.'
  }
  if (file.size > MAX_SLIP_BYTES) {
    return 'The payment slip must be 5 MB or smaller.'
  }
  return null
}

export async function fetchShopItems(): Promise<ShopItem[]> {
  const supabase = requireSupabase()
  const { data: rows, error } = await supabase
    .from('items')
    .select('*')
    .order('created_at', { ascending: false })
  if (error || !rows) return []
  const items = rows.map(mapItem)
  if (items.length === 0) return []
  const itemIds = items.map((item) => item.id)
  const { data: imageRows } = await supabase
    .from('item_images')
    .select('*')
    .in('item_id', itemIds)
    .order('position', { ascending: true })
  if (imageRows) {
    const images = imageRows.map(mapImage)
    for (const item of items) {
      item.images = images.filter((image) => image.itemId === item.id)
    }
  }
  const businessUserIds = [...new Set(items.map((item) => item.businessUserId))]
  const { data: profileRows } = await supabase
    .from('business_profiles')
    .select('user_id, business_name')
    .in('user_id', businessUserIds)
  const nameById = new Map<string, string>()
  if (profileRows) {
    for (const row of profileRows as {
      user_id: string
      business_name: string
    }[]) {
      nameById.set(row.user_id, row.business_name)
    }
  }
  return items.map((item) => ({
    ...item,
    businessName: nameById.get(item.businessUserId) ?? 'Business',
  }))
}

export async function fetchShopItemsForBusiness(
  businessUserId: string,
): Promise<ShopItem[]> {
  const items = await fetchShopItems()
  return items.filter(
    (item) => item.businessUserId === businessUserId && item.isAvailable,
  )
}

function mapOrderRow(
  row: Record<string, unknown>,
  companyById: Map<string, CustomerOrder['company']>,
  slipUrls: Map<string, string>,
): CustomerOrder {
  const items = ((row.order_items ?? []) as Record<string, unknown>[]).map(
    (itemRow): CustomerOrderItem => ({
      id: itemRow.id as string,
      orderId: itemRow.order_id as string,
      itemId: itemRow.item_id as string | null,
      itemName: itemRow.item_name as string,
      unitPriceNaira: itemRow.unit_price_naira as number,
      quantity: itemRow.quantity as number,
      createdAt: itemRow.created_at as string,
    }),
  )
  const paymentRow = ((row.payments ?? []) as Record<string, unknown>[])[0] ?? null
  const deliveryRow = ((row.deliveries ?? []) as Record<string, unknown>[])[0] ?? null
  const payment: CustomerPayment | null = paymentRow
    ? {
        id: paymentRow.id as string,
        orderId: paymentRow.order_id as string,
        status: paymentRow.status as CustomerPayment['status'],
        slipPath: paymentRow.slip_path as string | null,
        slipType: paymentRow.slip_type as 'image' | 'pdf' | null,
        slipUrl: (paymentRow.slip_path as string | null)
          ? (slipUrls.get(paymentRow.slip_path as string) ?? null)
          : null,
        rejectionReason: paymentRow.rejection_reason as string | null,
        reviewedAt: paymentRow.reviewed_at as string | null,
        createdAt: paymentRow.created_at as string,
      }
    : null
  const delivery: CustomerDeliveryState | null = deliveryRow
    ? {
        id: deliveryRow.id as string,
        status: deliveryRow.status as CustomerDeliveryState['status'],
        failedAttempts: (deliveryRow.failed_attempts as number) ?? 0,
      }
    : null
  return {
    id: row.id as string,
    orderNumber: row.order_number as string,
    customerUserId: row.customer_user_id as string,
    companyId: row.company_id as string | null,
    businessUserId: row.business_user_id as string | null,
    kind: row.kind as 'shop' | 'rider_only',
    status: row.status as OrderStatus,
    itemTotalNaira: row.item_total_naira as number,
    deliveryFeeNaira: row.delivery_fee_naira as number,
    totalNaira: row.total_naira as number,
    itemDescription: row.item_description as string | null,
    pickupAddress: row.pickup_address as Address | null,
    pickupPhone: row.pickup_phone as string | null,
    deliveryAddress: row.delivery_address as Address | null,
    recipientName: row.recipient_name as string | null,
    recipientPhone: row.recipient_phone as string | null,
    linkedOrderId: row.linked_order_id as string | null,
    prepMinutes: row.prep_minutes as number | null,
    businessAcceptedAt: row.business_accepted_at as string | null,
    readyAt: row.ready_at as string | null,
    riderRequestedAt: row.rider_requested_at as string | null,
    waitingDeadline: row.waiting_deadline as string | null,
    declineReason: row.decline_reason as string | null,
    failureReason: row.failure_reason as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    items,
    payment,
    delivery,
    company: (row.company_id as string | null)
      ? (companyById.get(row.company_id as string) ?? null)
      : null,
  }
}

export async function fetchCustomerOrders(
  customerUserId: string,
): Promise<CustomerOrder[]> {
  return fetchOrdersWithDetails('customer_user_id', customerUserId)
}

export interface OrderReview extends CustomerOrder {
  customerName: string
  customerPhone: string | null
}

async function fetchOrdersWithDetails(
  column: 'customer_user_id' | 'company_id' | 'business_user_id',
  value: string,
): Promise<OrderReview[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), payments(*), deliveries(*)')
    .eq(column, value)
    .order('created_at', { ascending: false })
  if (error || !data) return []
  const companies = await fetchCompanies()
  const companyById = new Map(companies.map((company) => [company.id, company]))
  const slipPaths = data
    .flatMap((row) => row.payments as Record<string, unknown>[])
    .map((payment) => payment.slip_path as string)
    .filter((path): path is string => Boolean(path))
  const slipUrls = new Map<string, string>()
  for (const path of slipPaths) {
    const { data: signed } = await supabase.storage
      .from('payment-slips')
      .createSignedUrl(path, 3600)
    if (signed) slipUrls.set(path, signed.signedUrl)
  }
  const customerIds = [
    ...new Set(data.map((row) => row.customer_user_id as string)),
  ]
  const nameById = new Map<string, string>()
  const phoneById = new Map<string, string | null>()
  if (customerIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, phone')
      .in('id', customerIds)
    if (profiles) {
      for (const row of profiles as {
        id: string
        full_name: string
        phone: string | null
      }[]) {
        nameById.set(row.id, row.full_name)
        phoneById.set(row.id, row.phone)
      }
    }
  }
  return data.map((row) => ({
    ...mapOrderRow(row, companyById, slipUrls),
    customerName: nameById.get(row.customer_user_id as string) ?? 'Customer',
    customerPhone: phoneById.get(row.customer_user_id as string) ?? null,
  }))
}

export async function fetchBusinessOrders(
  businessUserId: string,
): Promise<OrderReview[]> {
  return fetchOrdersWithDetails('business_user_id', businessUserId)
}

export async function placeShopOrder(input: {
  items: { itemId: string; quantity: number }[]
  deliveryAddress: Address
  recipientName: string
  recipientPhone: string
}): Promise<{ orderId?: string; error?: string }> {
  const { data, error } = await requireSupabase().rpc('place_shop_order', {
    p_items: input.items.map((item) => ({
      item_id: item.itemId,
      quantity: item.quantity,
    })),
    p_delivery_address: input.deliveryAddress,
    p_recipient_name: input.recipientName,
    p_recipient_phone: input.recipientPhone,
  })
  if (error) return { error: mapOrderError(error.message) }
  return { orderId: data as string }
}

function mapOrderError(message: string): string {
  if (message.includes('NOT_AUTHENTICATED')) return 'You must be signed in to continue.'
  if (message.includes('EMPTY_CART')) return 'Your cart is empty.'
  if (message.includes('INVALID_CART')) return 'Your cart has an invalid item or quantity.'
  if (message.includes('ITEM_UNAVAILABLE')) {
    return 'An item in your cart is no longer available. Refresh and try again.'
  }
  if (message.includes('CUSTOMER_PROFILE_REQUIRED')) {
    return 'Complete your customer profile before ordering.'
  }
  return message
}

export async function placeRiderOrder(input: {
  pickup: Address
  pickupPhone: string
  dropOff: Address
  deliveryPhone: string
  itemDescription: string
  deliveryFee: number
  recipientName: string
}): Promise<{ error?: string }> {
  const { error } = await requireSupabase().rpc('place_rider_order', {
    p_pickup_address: input.pickup,
    p_pickup_phone: input.pickupPhone,
    p_delivery_address: input.dropOff,
    p_delivery_phone: input.deliveryPhone,
    p_item_description: input.itemDescription,
    p_delivery_fee: input.deliveryFee,
    p_recipient_name: input.recipientName,
  })
  if (error) return { error: mapRiderOrderError(error.message) }
  return {}
}

function mapRiderOrderError(message: string): string {
  if (message.includes('NOT_AUTHENTICATED')) return 'You must be signed in to continue.'
  if (message.includes('DESCRIPTION_REQUIRED')) return 'Describe the item you are sending.'
  if (message.includes('INVALID_FEE')) return 'Enter a valid delivery fee.'
  if (message.includes('PICKUP_ADDRESS_REQUIRED')) return 'Pickup address is required.'
  if (message.includes('PICKUP_PHONE_REQUIRED')) return 'Pickup phone is required.'
  if (message.includes('RECIPIENT_PHONE_REQUIRED')) return 'Delivery phone is required.'
  if (message.includes('ADDRESS_REQUIRED')) return 'Delivery address is required.'
  return message
}

export async function requestRiderForOrder(input: {
  orderId: string
  pickup: Address
  pickupPhone: string
  dropOff: Address
  deliveryPhone: string
  itemDescription: string
}): Promise<string | null> {
  const { error } = await requireSupabase().rpc('request_rider_for_order', {
    p_order_id: input.orderId,
    p_pickup_address: input.pickup,
    p_pickup_phone: input.pickupPhone,
    p_delivery_address: input.dropOff,
    p_delivery_phone: input.deliveryPhone,
    p_item_description: input.itemDescription,
  })
  return error ? error.message : null
}

export async function acceptRiderRequest(orderId: string): Promise<string | null> {
  const { error } = await requireSupabase().rpc('accept_rider_request', {
    p_order_id: orderId,
  })
  if (error) {
    if (error.message.includes('NOT_CLOCKED_IN')) {
      return 'Clock in to accept orders.'
    }
    if (error.message.includes('ORDER_ALREADY_ACCEPTED')) {
      return 'Another rider already accepted this job.'
    }
    return error.message
  }
  return null
}

export async function riderArrivedPickup(orderId: string): Promise<string | null> {
  const { error } = await requireSupabase().rpc('rider_arrived_pickup', {
    p_order_id: orderId,
  })
  return error ? error.message : null
}

export async function verifyPickupCode(
  orderId: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await requireSupabase().rpc('verify_pickup_code', {
    p_order_id: orderId,
    p_code: code,
  })
  if (error) return { ok: false, error: mapCodeError(error.message) }
  return { ok: Boolean(data) }
}

export async function businessConfirmRider(orderId: string): Promise<string | null> {
  const { error } = await requireSupabase().rpc('business_confirm_rider', {
    p_order_id: orderId,
  })
  return error ? error.message : null
}

export async function riderArrivedDestination(
  orderId: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('rider_arrived_destination', {
    p_order_id: orderId,
  })
  return error ? error.message : null
}

export async function verifyDeliveryCode(
  orderId: string,
  code: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await requireSupabase().rpc('verify_delivery_code', {
    p_order_id: orderId,
    p_code: code,
  })
  if (error) return { ok: false, error: mapCodeError(error.message) }
  return { ok: Boolean(data) }
}

export async function customerConfirmReceived(orderId: string): Promise<string | null> {
  const { error } = await requireSupabase().rpc('customer_confirm_received', {
    p_order_id: orderId,
  })
  return error ? error.message : null
}

export async function getPickupCode(orderId: string): Promise<string | null> {
  const { data, error } = await requireSupabase().rpc('get_pickup_code', {
    p_order_id: orderId,
  })
  if (error) return null
  return data as string | null
}

export async function getDeliveryCode(orderId: string): Promise<string | null> {
  const { data, error } = await requireSupabase().rpc('get_delivery_code', {
    p_order_id: orderId,
  })
  if (error) return null
  return data as string | null
}

export async function getOrderProgress(
  orderId: string,
): Promise<OrderProgress | null> {
  const { data, error } = await requireSupabase().rpc('get_order_progress', {
    p_order_id: orderId,
  })
  if (error || !data) return null
  return data as OrderProgress
}

export async function getRiderIdentity(
  orderId: string,
): Promise<RiderIdentity | null> {
  const { data, error } = await requireSupabase().rpc('get_rider_identity', {
    p_order_id: orderId,
  })
  if (error || !data) return null
  return data as RiderIdentity
}

export async function businessAcceptOrder(
  orderId: string,
  prepMinutes?: number,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('business_accept_order', {
    p_order_id: orderId,
    p_prep_minutes: prepMinutes ?? null,
  })
  return error ? error.message : null
}

export async function businessMarkReady(orderId: string): Promise<string | null> {
  const { error } = await requireSupabase().rpc('business_mark_ready', {
    p_order_id: orderId,
  })
  return error ? error.message : null
}

export async function businessDeclineOrder(
  orderId: string,
  reason: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('business_decline_order', {
    p_order_id: orderId,
    p_reason: reason,
  })
  return error ? error.message : null
}

export async function businessExtendWaiting(
  orderId: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('business_extend_waiting', {
    p_order_id: orderId,
  })
  return error ? error.message : null
}

export async function businessCancelOrder(
  orderId: string,
  reason: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('business_cancel_order', {
    p_order_id: orderId,
    p_reason: reason,
  })
  return error ? error.message : null
}

export async function customerCancelRequest(
  orderId: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('customer_cancel_request', {
    p_order_id: orderId,
  })
  return error ? error.message : null
}

export async function sendRequestReminder(orderId: string): Promise<void> {
  await requireSupabase().rpc('send_request_reminder', { p_order_id: orderId })
}

export async function notifyNoRider(orderId: string): Promise<void> {
  await requireSupabase().rpc('notify_no_rider', { p_order_id: orderId })
}

export async function riderMarkNotReachable(
  orderId: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('rider_mark_not_reachable', {
    p_order_id: orderId,
  })
  return error ? error.message : null
}

export async function riderMarkNotResponding(
  orderId: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('rider_mark_not_responding', {
    p_order_id: orderId,
  })
  return error ? error.message : null
}

export async function riderReportFailedDelivery(
  orderId: string,
  reason: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('rider_report_failed_delivery', {
    p_order_id: orderId,
    p_reason: reason,
  })
  return error ? error.message : null
}

export async function fetchOrderEvents(
  orderId: string,
): Promise<OrderEvent[]> {
  const { data, error } = await requireSupabase()
    .from('order_events')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    orderId: row.order_id as string,
    actorUserId: row.actor_user_id as string | null,
    actorRole: row.actor_role as string | null,
    event: row.event as string,
    details: row.details as string | null,
    createdAt: row.created_at as string,
  }))
}

function mapCodeError(message: string): string {
  if (message.includes('CODE_LOCKED')) {
    return 'Too many wrong attempts — this step is locked.'
  }
  if (message.includes('FORBIDDEN')) {
    return 'You are not allowed to do this.'
  }
  if (message.includes('NOT_AT_PICKUP')) {
    return 'The rider has not arrived at pickup yet.'
  }
  if (message.includes('NOT_AT_DESTINATION')) {
    return 'The rider has not arrived at the destination yet.'
  }
  if (message.includes('NOT_VERIFIED')) {
    return 'The rider has not entered your delivery code yet.'
  }
  return message
}

export async function fetchRiderRequests(): Promise<CustomerOrder[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*), payments(*), deliveries(*)')
    .eq('status', 'rider_requested')
    .order('created_at', { ascending: true })
  if (error || !data) return []
  return data.map((row) => mapOrderRow(row, new Map(), new Map()))
}

export async function fetchRiderJobs(
  riderUserId: string,
): Promise<CustomerOrder[]> {
  const supabase = requireSupabase()
  const { data: deliveryRows, error } = await supabase
    .from('deliveries')
    .select('order_id')
    .eq('rider_user_id', riderUserId)
  if (error || !deliveryRows) return []
  const orderIds = (deliveryRows as { order_id: string }[]).map(
    (row) => row.order_id,
  )
  if (orderIds.length === 0) return []
  const { data, error: orderError } = await supabase
    .from('orders')
    .select('*, order_items(*), payments(*), deliveries(*)')
    .in('id', orderIds)
    .order('created_at', { ascending: false })
  if (orderError || !data) return []
  return data.map((row) => mapOrderRow(row, new Map(), new Map()))
}
