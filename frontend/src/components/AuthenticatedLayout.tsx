import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { SidebarProvider, useSidebar } from '../context/SidebarContext'
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

  return (
    <SidebarProvider>
      <LayoutInner>{children}</LayoutInner>
    </SidebarProvider>
  )
}
