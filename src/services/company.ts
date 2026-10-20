import { requireSupabase } from '../lib/supabase'
import type {
  Company,
  CompanyInput,
  CompanyMember,
  MemberType,
} from '../types'

interface CompanyRow {
  id: string
  owner_user_id: string
  name: string
  address: string
  city: string
  state: string
  phone: string
  bank_name: string
  bank_account_name: string
  bank_account_number: string
  created_at: string
  updated_at: string
}

interface CompanyMemberRow {
  id: string
  company_id: string
  user_id: string
  member_type: MemberType
  status: CompanyMember['status']
  rejection_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

interface MemberProfileRow {
  id: string
  full_name: string
  phone: string | null
}

export function mapCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    address: row.address,
    city: row.city,
    state: row.state,
    phone: row.phone,
    bankName: row.bank_name,
    bankAccountName: row.bank_account_name,
    bankAccountNumber: row.bank_account_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapCompanyMember(row: CompanyMemberRow): CompanyMember {
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    memberType: row.member_type,
    status: row.status,
    rejectionReason: row.rejection_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function fetchCompanies(): Promise<Company[]> {
  const { data, error } = await requireSupabase()
    .from('companies')
    .select('*')
    .order('name', { ascending: true })
  if (error || !data) return []
  return (data as CompanyRow[]).map(mapCompany)
}

export async function fetchCompany(id: string): Promise<Company | null> {
  const { data, error } = await requireSupabase()
    .from('companies')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return mapCompany(data as CompanyRow)
}

export async function fetchMyCompany(
  ownerUserId: string,
): Promise<Company | null> {
  const { data, error } = await requireSupabase()
    .from('companies')
    .select('*')
    .eq('owner_user_id', ownerUserId)
    .maybeSingle()
  if (error || !data) return null
  return mapCompany(data as CompanyRow)
}

export async function createCompany(
  ownerUserId: string,
  input: CompanyInput,
): Promise<{ company?: Company; error?: string }> {
  const { data, error } = await requireSupabase()
    .from('companies')
    .insert({
      owner_user_id: ownerUserId,
      name: input.name.trim(),
      address: input.address.trim(),
      city: input.city.trim(),
      state: input.state.trim(),
      phone: input.phone.trim(),
      bank_name: input.bankName.trim(),
      bank_account_name: input.bankAccountName.trim(),
      bank_account_number: input.bankAccountNumber.trim(),
    })
    .select()
    .single()
  if (error) {
    if (error.message.includes('duplicate key')) {
      return { error: 'You already created a dispatch company.' }
    }
    return { error: error.message }
  }
  return { company: mapCompany(data as CompanyRow) }
}

export async function fetchCompanyMembers(
  companyId: string,
): Promise<CompanyMember[]> {
  const supabase = requireSupabase()
  const { data: rows, error } = await supabase
    .from('company_members')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
  if (error || !rows) return []
  const members = (rows as CompanyMemberRow[]).map(mapCompanyMember)
  const userIds = members.map((member) => member.userId)
  if (userIds.length === 0) return members
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, phone')
    .in('id', userIds)
  if (profiles) {
    const byId = new Map(
      (profiles as MemberProfileRow[]).map((row) => [
        row.id,
        { fullName: row.full_name, phone: row.phone },
      ]),
    )
    for (const member of members) {
      member.profile = byId.get(member.userId)
    }
  }
  return members
}

export async function fetchMyMembership(
  userId: string,
  memberType: MemberType,
): Promise<CompanyMember | null> {
  const { data, error } = await requireSupabase()
    .from('company_members')
    .select('*')
    .eq('user_id', userId)
    .eq('member_type', memberType)
    .maybeSingle()
  if (error || !data) return null
  return mapCompanyMember(data as CompanyMemberRow)
}

export async function approveMember(memberId: string): Promise<string | null> {
  const { error } = await requireSupabase().rpc('approve_company_member', {
    p_member_id: memberId,
  })
  return error ? error.message : null
}

export async function rejectMember(
  memberId: string,
  reason: string,
): Promise<string | null> {
  const { error } = await requireSupabase().rpc('reject_company_member', {
    p_member_id: memberId,
    p_reason: reason,
  })
  return error ? error.message : null
}
