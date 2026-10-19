import { create } from 'zustand'

export interface AssignedCompany {
  id: string
  name: string
  code: string
}

export interface CompanyStore {
  /** Currently selected company ID for scoped operations */
  activeCompanyId: string | null
  /** All companies the user can access */
  availableCompanies: AssignedCompany[]
  /** Display name of selected company */
  activeCompanyName: string | null
  /** True when company contexts are still loading */
  isLoading: boolean
  /** True when a specific company is selected and CRUD is ready */
  isScopeReady: boolean
  /** Set the active company */
  setActiveCompany: (id: string, name?: string) => void
  /** Update available companies list */
  setAvailableCompanies: (companies: AssignedCompany[]) => void
  /** Set loading state */
  setLoading: (loading: boolean) => void
  /** Set scope readiness */
  setScopeReady: (ready: boolean) => void
  /** Clear all state (on logout) */
  reset: () => void
}

export const useCompanyStore = create<CompanyStore>((set) => ({
  activeCompanyId: null,
  availableCompanies: [],
  activeCompanyName: null,
  isLoading: true,
  isScopeReady: false,

  setActiveCompany: (id: string, name?: string) =>
    set((state) => {
      const comp = state.availableCompanies.find((c) => c.id === id)
      return {
        activeCompanyId: id,
        activeCompanyName: name || comp?.name || null,
        isScopeReady: true,
      }
    }),

  setAvailableCompanies: (companies) =>
    set({
      availableCompanies: companies,
      isLoading: false,
    }),

  setLoading: (loading) => set({ isLoading: loading }),

  setScopeReady: (ready) => set({ isScopeReady: ready }),

  reset: () =>
    set({
      activeCompanyId: null,
      availableCompanies: [],
      activeCompanyName: null,
      isLoading: true,
      isScopeReady: false,
    }),
}))

/**
 * Synchronize the Zustand store with CompanyContext values.
 * Call this in a useEffect inside any component that has access to both.
 */
export function syncCompanyStore(params: {
  selectedCompanyId: string | null
  selectedCompanyName: string | null
  availableCompanies: { id: string; name: string; code: string }[]
  isLoading: boolean
  isScopeReady: boolean
}) {
  const store = useCompanyStore.getState()

  if (JSON.stringify(store.availableCompanies.map((c) => c.id).sort()) !==
      JSON.stringify(params.availableCompanies.map((c) => c.id).sort())) {
    useCompanyStore.getState().setAvailableCompanies(params.availableCompanies)
  }

  if (store.activeCompanyId !== params.selectedCompanyId) {
    useCompanyStore.getState().setActiveCompany(
      params.selectedCompanyId || '',
      params.selectedCompanyName || undefined
    )
  }

  if (store.isLoading !== params.isLoading) {
    useCompanyStore.getState().setLoading(params.isLoading)
  }

  if (store.isScopeReady !== params.isScopeReady) {
    useCompanyStore.getState().setScopeReady(params.isScopeReady)
  }
}
