import { ShieldAlert } from 'lucide-react'
import { useCompany } from '../context/CompanyContext'
import { useAuth } from '../context/AuthContext'

interface Props {
  children: React.ReactNode
}

export function CompanyRouteGuard({ children }: Props) {
  const { user } = useAuth()
  const { availableCompanies, isCompanyRestricted, selectedCompanyId } = useCompany()

  // Enforce for restricted roles (executive, team-leader)
  if (isCompanyRestricted && availableCompanies.length > 0 && selectedCompanyId) {
    const isAuthorized = availableCompanies.some(c => c.id === selectedCompanyId)
    if (!isAuthorized) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '60vh', gap: 16, color: '#6b7280', textAlign: 'center',
        }}>
          <ShieldAlert size={48} color="#ef4444" />
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>Access Denied</h2>
          <p style={{ margin: 0, fontSize: 14, maxWidth: 400 }}>
            You are not authorized to access data for the selected company.
            Please switch to an authorized company from the dashboard.
          </p>
        </div>
      )
    }
  }

  return <>{children}</>
}
