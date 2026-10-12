export type Role = 'customer' | 'rider' | 'business'

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
}

export interface User {
  id: string
  fullName: string
  email: string
  password: string
  phone: string
  role: Role
  businessName?: string
  defaultAddress?: Address
  riderProfile?: RiderProfile
}

export interface AuthSession {
  userId: string
  fullName: string
  email: string
  role: Role
  remembered: boolean
  loginAt: string
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
