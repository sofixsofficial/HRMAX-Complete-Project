import { createContext, useContext, useState, type ReactNode } from 'react'

interface SidebarContextType {
  collapsed: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  toggle: () => {},
})

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setCollapsed(prev => !prev) }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
