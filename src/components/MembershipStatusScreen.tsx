import { useEffect, useState } from 'react'
import type { Company, CompanyMember, MemberType, User, UserRole } from '../types'
import type { ThemeMode } from '../utils/storage'
import { ROLE_LABELS } from '../data/roles'
import { fetchCompany, fetchMyMembership } from '../services/company'
import { DashboardFooter } from './DashboardFooter'
import { DashboardHeader } from './DashboardHeader'
import { IconClock, IconXCircle } from './Icons'

interface MembershipStatusScreenProps {
  user: User
  role: UserRole
  theme: ThemeMode
  roles: UserRole[]
  activeRoleId: string | null
  onToggleTheme: () => void
  onLogout: () => void
  onSwitchRole: (roleId: string) => void
  onAddRole: () => void
}

export function MembershipStatusScreen({
  user,
  role,
  theme,
  roles,
  activeRoleId,
  onToggleTheme,
  onLogout,
  onSwitchRole,
  onAddRole,
}: MembershipStatusScreenProps) {
  const [company, setCompany] = useState<Company | null>(null)
  const [membership, setMembership] = useState<CompanyMember | null>(null)

  useEffect(() => {
    let mounted = true
    if (role.companyId) {
      void fetchCompany(role.companyId).then((result) => {
        if (mounted) setCompany(result)
      })
    }
    void fetchMyMembership(role.userId, role.roleType as MemberType).then(
      (result) => {
        if (mounted) setMembership(result)
      },
    )
    return () => {
      mounted = false
    }
  }, [role.companyId, role.userId, role.roleType])

  const isPending = role.status === 'pending'

  return (
    <div className="dashboard">
      <DashboardHeader
        user={user}
        theme={theme}
        roles={roles}
        activeRoleId={activeRoleId}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
        onSwitchRole={onSwitchRole}
        onAddRole={onAddRole}
      />

      <main className="dash-main container">
        <div className="page-head">
          <h1>{ROLE_LABELS[role.roleType]}</h1>
          <p>
            {isPending
              ? 'Your application is under review.'
              : 'Your application was rejected.'}
          </p>
        </div>

        <div className="card membership-status">
          <span
            className={`badge ${isPending ? 'badge-pending' : 'badge-delayed'}`}
          >
            {isPending ? 'Pending approval' : 'Rejected'}
          </span>
          {isPending ? <IconClock size={26} /> : <IconXCircle size={26} />}
          <h2>
            {isPending
              ? `Waiting for ${company?.name ?? 'your dispatch company'}`
              : 'Application rejected'}
          </h2>
          <p>
            {isPending
              ? 'A dispatch company owner must approve your account before you can use this role. You can keep using your other roles in the meantime.'
              : 'The dispatch company rejected your registration. You cannot use this role until the company approves you.'}
          </p>
          {!isPending && membership?.rejectionReason && (
            <div className="auth__error">
              <IconXCircle size={16} />
              {membership.rejectionReason}
            </div>
          )}
        </div>
      </main>

      <DashboardFooter />
    </div>
  )
}
