export type Role = 'customer' | 'rider' | 'business'

export type RoleStatus = 'active' | 'pending' | 'rejected'

export type MemberType = 'business' | 'rider'

export type MemberStatus = 'pending' | 'approved' | 'rejected'

export interface Company {
  id: string
  ownerUserId: string
  name: string
  address: string
  city: string
  state: string
  phone: string
  bankName: string
  bankAccountName: string
  bankAccountNumber: string
  createdAt: string
  updatedAt: string
}

export interface CompanyInput {
  name: string
  address: string
  city: string
  state: string
  phone: string
  bankName: string
  bankAccountName: string
  bankAccountNumber: string
}

export interface CompanyMember {
  id: string
  companyId: string
  userId: string
  memberType: MemberType
  status: MemberStatus
  rejectionReason: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
  profile?: { fullName: string; phone: string | null }
}

export interface ItemImage {
  id: string
  itemId: string
  storagePath: string
  position: number
  createdAt: string
  url: string | null
}

export interface Item {
  id: string
  businessUserId: string
  companyId: string
  name: string
  description: string
  priceNaira: number
  quantity: number
  isAvailable: boolean
  listedOn: string
  createdAt: string
  updatedAt: string
  images: ItemImage[]
}

export interface ItemInput {
  name: string
  description: string
  priceNaira: string
  quantity: string
}

export interface ShopItem extends Item {
  businessName: string
}

export type PaymentStatus = 'awaiting' | 'submitted' | 'confirmed' | 'rejected'

export interface CustomerPayment {
  id: string
  orderId: string
  status: PaymentStatus
  slipPath: string | null
  slipType: 'image' | 'pdf' | null
  slipUrl: string | null
  rejectionReason: string | null
  reviewedAt: string | null
  createdAt: string
}

export interface CustomerOrderItem {
  id: string
  orderId: string
  itemId: string | null
  itemName: string
  unitPriceNaira: number
  quantity: number
  createdAt: string
}

export interface CustomerOrder {
  id: string
  orderNumber: string
  customerUserId: string
  companyId: string | null
  businessUserId: string | null
  kind: 'shop' | 'rider_only'
  status: OrderStatus
  itemTotalNaira: number
  deliveryFeeNaira: number
  totalNaira: number
  itemDescription: string | null
  pickupAddress: Address | null
  pickupPhone: string | null
  deliveryAddress: Address | null
  recipientName: string | null
  recipientPhone: string | null
  linkedOrderId: string | null
  prepMinutes: number | null
  businessAcceptedAt: string | null
  readyAt: string | null
  riderRequestedAt: string | null
  waitingDeadline: string | null
  declineReason: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
  items: CustomerOrderItem[]
  payment: CustomerPayment | null
  delivery: CustomerDeliveryState | null
  company: Company | null
}

export type DeliveryState =
  | 'accepted'
  | 'picked_up'
  | 'delivered_pending_code'
  | 'delivered'
  | 'cancelled'

export interface CustomerDeliveryState {
  id: string
  status: DeliveryState
  failedAttempts: number
}

export interface RiderJob {
  deliveryId: string | null
  orderId: string
  orderNumber: string
  status: OrderStatus
  deliveryStatus: DeliveryState | null
  companyName: string
  pickupLabel: string
  dropOffLabel: string
  feeNaira: number
  itemSummary: string
  createdAt: string
}

export interface AppNotification {
  id: string
  userId: string
  title: string
  body: string
  kind: string
  orderId: string | null
  read: boolean
  createdAt: string
}

export interface BusinessProfile {
  userId: string
  businessName: string
  businessAddress: string | null
  businessPhone: string | null
}

export interface OrderProgress {
  pickupVerified: boolean
  businessConfirmed: boolean
  deliveryVerified: boolean
  pickupLocked: boolean
  deliveryLocked: boolean
  pickupAttempts: number
  deliveryAttempts: number
  ready: boolean
  businessAcceptedAt: string | null
  readyAt: string | null
  riderRequestedAt: string | null
  waitingDeadline: string | null
  prepMinutes: number | null
  declineReason: string | null
  failureReason: string | null
}

export interface OrderEvent {
  id: string
  orderId: string
  actorUserId: string | null
  actorRole: string | null
  event: string
  details: string | null
  createdAt: string
}

export interface RiderIdentity {
  fullName: string | null
  phone: string | null
  vehicleType: string | null
  plateNumber: string | null
}

export interface UserRole {
  id: string
  userId: string
  roleType: Role
  companyId: string | null
  status: RoleStatus
  createdAt: string
  updatedAt: string
}

export type OrderStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'payment_submitted'
  | 'payment_confirmed'
  | 'payment_rejected'
  | 'awaiting_business_approval'
  | 'awaiting_rider'
  | 'rider_assigned'
  | 'picked_up'
  | 'delivered'
  | 'delayed'
  | 'cancelled'
  | 'placed'
  | 'accepted_by_business'
  | 'ready_for_pickup'
  | 'rider_requested'
  | 'rider_accepted'
  | 'arrived_at_pickup'
  | 'pickup_verified'
  | 'arrived_at_destination'
  | 'delivery_failed'

export type DeliveryStatus =
  | 'pending_approval'
  | 'approved'
  | 'assigned'
  | 'in_transit'
  | 'out_for_delivery'
  | 'awaiting_otp'
  | 'delivered'

export type BoostKind = 'delivery' | 'listing'
export type BoostStatus = 'inactive' | 'active'

export type ToastTone = 'success' | 'error' | 'info'

export type NotifyFn = (text: string, tone?: ToastTone) => void

export interface GeoPoint {
  lat: number
  lng: number
}

export interface Address {
  label: string
  line1: string
  city: string
  state: string
  coordinates: GeoPoint
}

export interface TrackingEvent {
  id: string
  timestamp: string
  title: string
  location: string
  description: string
  tone: 'info' | 'success' | 'warning'
}

export interface Delivery {
  id: string
  waybillNumber: string
  customerId: string
  customerEmail: string
  customerName: string
  recipientName: string
  recipientPhone: string
  itemDescription: string
  amountNgn?: number
  pickup: Address
  dropOff: Address
  status: DeliveryStatus
  eta?: string
  routeLabel: string
  assignedRiderId?: string
  riderName?: string
  boosted: boolean
  pendingOtp?: string
  otpRequestedAt?: string
  deliveredAt?: string
  createdAt: string
  timeline: TrackingEvent[]
}

export interface NewOrderInput {
  itemDescription: string
  amountNgn: string
  label: string
  line1: string
  city: string
  state: string
}

export interface BoostItem {
  id: string
  kind: BoostKind
  title: string
  description: string
  audience: string
  budgetNgn: number
  status: BoostStatus
  ownerId: string
  linkedDeliveryId?: string
  createdAt: string
}

export interface RiderProfile {
  clockedIn: boolean
  clockedInAt?: string
  vehicleType?: string
  plateNumber?: string
  zone?: string
}

export interface RegistrationInput {
  fullName: string
  email: string
  password: string
  phone: string
  role: Role
  businessName?: string
  businessAddress?: string
  businessPhone?: string
  vehicleType?: string
  plateNumber?: string
  zone?: string
}

export interface User {
  id: string
  fullName: string
  email: string
  phone: string
  role: Role
  businessName?: string
  defaultAddress?: Address
  riderProfile?: RiderProfile
}

export interface PaymentResult {
  reference: string
  amount: number
  currency: 'NGN'
  status: 'successful'
  processor: 'flutterwave-test'
  paidAt: string
}

export interface GeofenceResult {
  distanceMeters: number
  radiusMeters: number
  passed: boolean
  scannedAt: string
}

export interface OtpVerification {
  code: string
  input: string
  state: 'idle' | 'sent' | 'verified'
  attempts: number
  sentAt?: string
  verifiedAt?: string
  error?: string
}

export interface ToastMessage {
  id: number
  text: string
  tone: ToastTone
}
