import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { SidebarProvider, useSidebar } from '../context/SidebarContext'
import { ClockProvider } from '../context/ClockContext'
import { Sidebar } from './Sidebar'

function LayoutInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar()
  return (
    <div className={`hrm-container${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar />
      {children}
    </div>
  )
}

export function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  // ClockProvider = the single live time source shared by the header + hero
  // (hrmax-hero reference wiring). Mounted here — not at the app root — so the
  // login screens never trigger the location/weather resolution.
  return (
    <ClockProvider>
      <SidebarProvider>
        <LayoutInner>{children}</LayoutInner>
      </SidebarProvider>
    </ClockProvider>
  )
}
