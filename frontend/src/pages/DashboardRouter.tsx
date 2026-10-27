import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { getEmployeeByUserId } from '../services/employeeService'
import { ExecutiveDashboard } from './dashboards/ExecutiveDashboard'
import { TLOperationalDashboard } from './dashboards/TLOperationalDashboard'
import { CompanyDashboard } from './dashboards/CompanyDashboard'
import { EmployeeDashboard } from './dashboards/EmployeeDashboard'
import { ReportingManagerDashboard } from './dashboards/ReportingManagerDashboard'
import { Dashboard as AdminDashboard } from './Dashboard'

function EmployeeOrManagerRouter() {
  const { user } = useAuth()
  const [isRm, setIsRm] = useState<boolean | null>(null)

  useEffect(() => {
    if (!user) { setIsRm(false); return }
    getEmployeeByUserId(user.id).then(emp => {
      setIsRm(!!(emp as any)?.isReportingManager)
    }).catch(() => setIsRm(false))
  }, [user])

  if (isRm === null) {
    return (
      <div className="page-container">
        <div className="page-content">
          <div className="loading-container">
            <Loader2 className="animate-spin" size={32} />
            <p>Loading dashboard...</p>
          </div>
        </div>
      </div>
    )
  }

  return isRm ? <ReportingManagerDashboard /> : <EmployeeDashboard />
}

export function DashboardRouter() {
  const { user } = useAuth()

  switch (user?.role) {
    case 'company-admin':
      return <CompanyDashboard />
    case 'hr':
      return <CompanyDashboard />
    case 'executive':
      return <ExecutiveDashboard />
    case 'team-leader':
      return <TLOperationalDashboard />
    case 'reporting-manager':
      return <ReportingManagerDashboard />
    case 'employee':
      return <EmployeeOrManagerRouter />
    case 'master-admin':
    default:
      return <AdminDashboard />
  }
}
