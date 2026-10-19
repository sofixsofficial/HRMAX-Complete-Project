import { Building2, Lock } from 'lucide-react'
import { useCompany } from '../context/CompanyContext'
import { useAccessControl } from '../context/AccessControlContext'
import { useAuth } from '../context/AuthContext'

/**
 * ScopeIndicator — shows "Managing: [Company Name]" badge in page content area.
 * Place below the page title to show the current company context.
 */
export function ScopeIndicator() {
  const { user } = useAuth()
  const { selectedCompanyName, selectedCompanyId, availableCompanies } = useCompany()
  const { isViewOnly, scopeCompanyId } = useAccessControl()

  // Master Admin uses per-page filters — no global scope badge
  if (user?.role === 'master-admin') return null

  // Restricted roles with zero assigned companies have nothing to show
  if (!selectedCompanyId && !scopeCompanyId && availableCompanies.length === 0) return null

  const displayName = selectedCompanyName || 'All Companies'

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 12px',
      borderRadius: 20,
      background: isViewOnly ? '#fff8f0' : '#f0fdf4',
      border: `1px solid ${isViewOnly ? '#fed7aa' : '#bbf7d0'}`,
      fontSize: 12,
      fontWeight: 600,
      color: isViewOnly ? '#9a3412' : '#16a34a',
      whiteSpace: 'nowrap',
      marginBottom: 8,
    }}>
      <Building2 size={14} />
      <span>{isViewOnly ? 'Viewing:' : 'Managing:'}</span>
      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {displayName}
      </span>
      {isViewOnly && <Lock size={11} />}
    </div>
  )
}
