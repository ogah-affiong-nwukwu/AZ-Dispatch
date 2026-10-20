import { requireSupabase } from '../lib/supabase'
import type { BusinessProfile } from '../types'

interface BusinessProfileRow {
  user_id: string
  business_name: string
  business_address: string | null
  business_phone: string | null
}

function mapBusinessProfile(row: BusinessProfileRow): BusinessProfile {
  return {
    userId: row.user_id,
    businessName: row.business_name,
    businessAddress: row.business_address,
    businessPhone: row.business_phone,
  }
}

export function hasBusinessDetails(profile: BusinessProfile | null): boolean {
  return Boolean(profile?.businessAddress?.trim() && profile?.businessPhone?.trim())
}

export function validateBusinessPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) {
    return 'Enter a valid phone number (7–15 digits).'
  }
  return null
}

export async function fetchBusinessProfile(
  userId: string,
): Promise<BusinessProfile | null> {
  const { data, error } = await requireSupabase()
    .from('business_profiles')
    .select('user_id, business_name, business_address, business_phone')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return mapBusinessProfile(data as BusinessProfileRow)
}

export async function saveBusinessDetails(
  userId: string,
  businessName: string,
  address: string,
  phone: string,
): Promise<string | null> {
  const { error } = await requireSupabase()
    .from('business_profiles')
    .update({
      business_name: businessName.trim(),
      business_address: address.trim(),
      business_phone: phone.trim(),
    })
    .eq('user_id', userId)
  return error ? error.message : null
}

export async function fetchBusinesses(): Promise<BusinessProfile[]> {
  const { data, error } = await requireSupabase()
    .from('business_profiles')
    .select('user_id, business_name, business_address, business_phone')
    .order('business_name', { ascending: true })
  if (error || !data) return []
  return (data as BusinessProfileRow[]).map(mapBusinessProfile)
}
