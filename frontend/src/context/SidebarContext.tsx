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
  // Mobile (≤768px): the sidebar is a slide-in drawer — start CLOSED so page
  // content is visible on first paint. Desktop: expanded, as before.
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false,
  )
  return (
    <SidebarContext.Provider value={{ collapsed, toggle: () => setCollapsed(prev => !prev) }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
