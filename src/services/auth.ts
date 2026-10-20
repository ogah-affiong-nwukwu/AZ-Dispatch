import { requireSupabase } from '../lib/supabase'
import type {
  Address,
  RegistrationInput,
  RiderProfile,
  Role,
  RoleStatus,
  UserRole,
} from '../types'

export interface Profile {
  id: string
  fullName: string
  phone: string | null
  businessName: string | null
  defaultAddress: Address | null
  riderProfile: RiderProfile | null
}

interface ProfileRow {
  id: string
  full_name: string
  phone: string | null
  business_name: string | null
  default_address: Address | null
  rider_profile: RiderProfile | null
}

interface RoleRow {
  id: string
  user_id: string
  role_type: Role
  company_id: string | null
  status: RoleStatus
  created_at: string
  updated_at: string
}

export function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    businessName: row.business_name,
    defaultAddress: row.default_address,
    riderProfile: row.rider_profile,
  }
}

export function mapRole(row: RoleRow): UserRole {
  return {
    id: row.id,
    userId: row.user_id,
    roleType: row.role_type,
    companyId: row.company_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapRoleInsertError(message: string): string {
  if (message.includes('duplicate key') || message.includes('unique constraint')) {
    return 'You already have this role on your account.'
  }
  return message
}

export interface SignInResult {
  error?: string
  missingRole?: Role
}

export interface AuthResult {
  error?: string
  notice?: string
}

export async function registerWithPassword(
  input: RegistrationInput,
): Promise<AuthResult | null> {
  const supabase = requireSupabase()
  const email = input.email.trim().toLowerCase()
  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      data: {
        full_name: input.fullName.trim(),
        role: input.role,
        business_name: input.businessName?.trim() ?? null,
        vehicle_type: input.vehicleType?.trim() ?? null,
        plate_number: input.plateNumber?.trim() ?? null,
        zone: input.zone?.trim() ?? null,
      },
    },
  })
  console.log('[auth] signUp result:', {
    user: data.user?.id ?? null,
    session: Boolean(data.session),
    error: error?.message ?? null,
  })
  if (error) {
    console.error('[auth] signUp failed:', error.message)
    if (error.message.toLowerCase().includes('already registered')) {
      return {
        error:
          'An account with this email already exists. Sign in instead, then add another role from the dashboard header.',
      }
    }
    return { error: error.message }
  }
  const userId = data.user?.id
  if (!userId || !data.session) {
    console.warn(
      '[auth] signUp created an account but returned no session — email confirmation is likely enabled.',
    )
    return {
      notice:
        'Account created! Please check your email to confirm your account.',
    }
  }
  const updates: Record<string, unknown> = {
    full_name: input.fullName.trim(),
    phone: input.phone.trim(),
  }
  if (input.businessName?.trim()) {
    updates.business_name = input.businessName.trim()
  }
  if (input.role === 'rider') {
    updates.rider_profile = {
      clockedIn: false,
      vehicleType: input.vehicleType?.trim() || 'Motorcycle',
      plateNumber: input.plateNumber?.trim() || '',
      zone: input.zone?.trim() || '',
    } satisfies RiderProfile
  }
  const { error: profileError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', userId)
  if (profileError) {
    console.error('[auth] profile update failed:', profileError.message)
  }
  const { error: roleError } = await supabase
    .from('roles')
    .upsert(
      { user_id: userId, role_type: input.role },
      { onConflict: 'user_id,role_type', ignoreDuplicates: true },
    )
  if (roleError) {
    console.error('[auth] role insert failed:', roleError.message)
    return { error: mapRoleInsertError(roleError.message) }
  }
  const roleProfileError = await upsertRoleProfile(userId, input.role, {
    businessName: input.businessName,
    businessAddress: input.businessAddress,
    businessPhone: input.businessPhone,
    vehicleType: input.vehicleType,
    plateNumber: input.plateNumber,
    zone: input.zone,
    phone: input.phone,
  })
  if (roleProfileError) {
    return { error: roleProfileError }
  }
  console.log('[auth] registerWithPassword done:', { userId, role: input.role })
  return null
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<string | null> {
  const { data, error } = await requireSupabase().auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })
  console.log('[auth] signInWithPassword result:', {
    user: data.user?.id ?? null,
    session: Boolean(data.session),
    error: error?.message ?? null,
  })
  if (!error) return null
  console.error('[auth] signInWithPassword failed:', error.message)
  if (error.message.toLowerCase().includes('invalid login credentials')) {
    return 'No account matches these credentials.'
  }
  if (error.message.toLowerCase().includes('email not confirmed')) {
    return 'Your email is not confirmed yet. Check your inbox and click the confirmation link, then sign in again.'
  }
  return error.message
}

export async function signOut(): Promise<void> {
  await requireSupabase().auth.signOut()
}

export interface AddRoleOptions {
  businessName?: string
  businessAddress?: string
  businessPhone?: string
  vehicleType?: string
  plateNumber?: string
  zone?: string
}

export async function addRole(
  userId: string,
  roleType: Role,
  options: AddRoleOptions = {},
): Promise<string | null> {
  const supabase = requireSupabase()
  const updates: Record<string, unknown> = {}
  if (roleType === 'business' && options.businessName?.trim()) {
    updates.business_name = options.businessName.trim()
  }
  if (roleType === 'rider') {
    updates.rider_profile = {
      clockedIn: false,
      vehicleType: options.vehicleType?.trim() || 'Motorcycle',
      plateNumber: options.plateNumber?.trim() || '',
      zone: options.zone?.trim() || '',
    } satisfies RiderProfile
  }
  if (Object.keys(updates).length > 0) {
    const { error: profileError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
    if (profileError) {
      console.error('[auth] profile update failed:', profileError.message)
    }
  }
  const { error } = await supabase
    .from('roles')
    .upsert(
      { user_id: userId, role_type: roleType },
      { onConflict: 'user_id,role_type', ignoreDuplicates: true },
    )
  if (error) {
    console.error('[auth] addRole insert failed:', error.message)
    return mapRoleInsertError(error.message)
  }
  const roleProfileError = await upsertRoleProfile(userId, roleType, options)
  if (roleProfileError) return roleProfileError
  console.log('[auth] addRole done:', { userId, roleType })
  return null
}

async function upsertRoleProfile(
  userId: string,
  roleType: Role,
  options: {
    businessName?: string
    businessAddress?: string
    businessPhone?: string
    vehicleType?: string
    plateNumber?: string
    zone?: string
    phone?: string
  },
): Promise<string | null> {
  const supabase = requireSupabase()
  try {
    if (roleType === 'customer') {
      await supabase.from('customer_profiles').upsert(
        { user_id: userId, phone: options.phone?.trim() || null },
        { onConflict: 'user_id' },
      )
    } else if (roleType === 'business') {
      await supabase.from('business_profiles').upsert(
        {
          user_id: userId,
          company_id: null,
          business_name: options.businessName?.trim() || 'Business',
          business_address: options.businessAddress?.trim() || null,
          business_phone: options.businessPhone?.trim() || null,
        },
        { onConflict: 'user_id' },
      )
    } else if (roleType === 'rider') {
      await supabase.from('rider_profiles').upsert(
        {
          user_id: userId,
          clocked_in: false,
          vehicle_type: options.vehicleType?.trim() || 'Motorcycle',
          plate_number: options.plateNumber?.trim() || '',
          zone: options.zone?.trim() || '',
        },
        { onConflict: 'user_id' },
      )
    }
    return null
  } catch (cause) {
    console.error('[auth] role profile upsert failed:', cause)
    return 'Role created, but the role profile could not be saved. Have the migrations (0011) run?'
  }
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await requireSupabase()
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  console.log('[auth] fetchProfile result:', {
    userId,
    data: data ? { id: data.id, full_name: data.full_name } : null,
    error: error?.message ?? null,
  })
  if (error || !data) {
    console.error(
      '[auth] fetchProfile failed:',
      error?.message ?? 'no profile row found — have the migrations run?',
    )
    return null
  }
  return mapProfile(data as ProfileRow)
}

export async function ensureProfile(): Promise<Profile | null> {
  const { data, error } = await requireSupabase().rpc('ensure_profile')
  console.log('[auth] ensure_profile result:', {
    data: data ? { id: data.id } : null,
    error: error?.message ?? null,
  })
  if (error || !data) {
    console.error('[auth] ensure_profile failed:', error?.message ?? 'no row')
    return null
  }
  return mapProfile(data as ProfileRow)
}

export async function ensureRole(
  userId: string,
  roleType: Role,
): Promise<boolean> {
  const { error } = await requireSupabase()
    .from('roles')
    .upsert(
      { user_id: userId, role_type: roleType },
      { onConflict: 'user_id,role_type', ignoreDuplicates: true },
    )
  if (error) {
    console.error('[auth] ensureRole failed:', error.message)
    return false
  }
  console.log('[auth] ensureRole created role:', roleType)
  return true
}

export async function fetchRoles(userId: string): Promise<UserRole[]> {
  const { data, error } = await requireSupabase()
    .from('roles')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error || !data) {
    console.error(
      '[auth] fetchRoles failed:',
      error?.message ?? 'no role rows found',
    )
    return []
  }
  return (data as RoleRow[]).map(mapRole)
}

export interface ProfilePatch {
  defaultAddress?: Address | null
  riderProfile?: RiderProfile | null
}

export async function updateProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<void> {
  const supabase = requireSupabase()
  const updates: Record<string, unknown> = {}
  if ('defaultAddress' in patch) {
    updates.default_address = patch.defaultAddress ?? null
  }
  if ('riderProfile' in patch) {
    updates.rider_profile = patch.riderProfile ?? null
  }
  await supabase.from('profiles').update(updates).eq('id', userId)
  if ('defaultAddress' in patch) {
    await supabase
      .from('customer_profiles')
      .upsert(
        { user_id: userId, default_address: patch.defaultAddress ?? null },
        { onConflict: 'user_id' },
      )
  }
}

export interface CustomerProfile {
  phone: string | null
  defaultAddress: Address | null
}

export async function fetchCustomerProfile(
  userId: string,
): Promise<CustomerProfile | null> {
  const { data, error } = await requireSupabase()
    .from('customer_profiles')
    .select('phone, default_address')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { phone: string | null; default_address: Address | null }
  return { phone: row.phone, defaultAddress: row.default_address }
}

export async function saveCustomerProfile(
  userId: string,
  patch: { phone?: string; defaultAddress?: Address },
): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (patch.phone !== undefined) updates.phone = patch.phone.trim()
  if (patch.defaultAddress !== undefined) {
    updates.default_address = patch.defaultAddress
  }
  await requireSupabase()
    .from('customer_profiles')
    .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' })
  if (patch.phone !== undefined) {
    await requireSupabase()
      .from('profiles')
      .update({ phone: patch.phone.trim() })
      .eq('id', userId)
  }
}

export interface RiderWorkProfile {
  clockedIn: boolean
  clockedInAt: string | null
  vehicleType: string | null
  plateNumber: string | null
  zone: string | null
}

export async function fetchRiderWorkProfile(
  userId: string,
): Promise<RiderWorkProfile | null> {
  const { data, error } = await requireSupabase()
    .from('rider_profiles')
    .select('clocked_in, clocked_in_at, vehicle_type, plate_number, zone')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as {
    clocked_in: boolean
    clocked_in_at: string | null
    vehicle_type: string | null
    plate_number: string | null
    zone: string | null
  }
  return {
    clockedIn: row.clocked_in,
    clockedInAt: row.clocked_in_at,
    vehicleType: row.vehicle_type,
    plateNumber: row.plate_number,
    zone: row.zone,
  }
}

export async function clockInRider(
  userId: string,
  details: { vehicleType: string; plateNumber: string; zone: string },
): Promise<void> {
  const { error } = await requireSupabase()
    .from('rider_profiles')
    .upsert(
      {
        user_id: userId,
        clocked_in: true,
        clocked_in_at: new Date().toISOString(),
        vehicle_type: details.vehicleType,
        plate_number: details.plateNumber,
        zone: details.zone,
      },
      { onConflict: 'user_id' },
    )
  if (error) {
    console.error('[auth] clockInRider failed:', error.message)
  }
}

export async function clockOutRider(userId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('rider_profiles')
    .update({ clocked_in: false })
    .eq('user_id', userId)
  if (error) {
    console.error('[auth] clockOutRider failed:', error.message)
  }
}

export async function fetchAvailableRiders(): Promise<Profile[]> {
  const supabase = requireSupabase()
  const { data: rows, error } = await supabase
    .from('rider_profiles')
    .select('user_id, vehicle_type, plate_number, zone')
    .eq('clocked_in', true)
  if (error || !rows) return []
  const ids = (rows as { user_id: string }[]).map((row) => row.user_id)
  if (ids.length === 0) return []
  const { data: profiles } = await supabase
    .from('profiles')
    .select('*')
    .in('id', ids)
  if (!profiles) return []
  return (profiles as ProfileRow[]).map((row) => ({
    ...mapProfile(row),
    riderProfile: { clockedIn: true },
  }))
}
