import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { collection, getDocs, query, where, doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../config/firebase'
import { useAuth } from './AuthContext'

interface ExecutiveInfo {
  id: string
  name: string
  email: string
  assignedCompanyIds: string[]
}

interface CompanyInfo {
  id: string
  name: string
  code: string
}

interface TLFilterContextType {
  executives: ExecutiveInfo[]
  /** All companies across the whole TL portfolio (every linked executive). */
  allCompanies: CompanyInfo[]
  /** Companies assigned to the currently selected executive (empty when none selected). */
  companies: CompanyInfo[]
  selectedExecutiveId: string | null
  selectedCompanyId: string | null
  setExecutive: (id: string) => void
  setCompany: (id: string) => void
  resetFilters: () => void
  isLoading: boolean
  /** True when a scope can be shown — an executive is selected (company optional; aggregated view). */
  isReady: boolean
  currentExecutive: ExecutiveInfo | null
  currentCompany: CompanyInfo | null
}

const getDocsInBatches = async (collectionName: string, ids: string[]) => {
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += 10) {
    batches.push(ids.slice(i, i + 10))
  }
  if (batches.length === 0) return [] as any[]

  // Per-document getDoc: the role-based rules call getUserData() (get()), which
  // Firestore cannot evaluate for list/query rules — that rejects a `__name__ in`
  // query with "Missing or insufficient permissions". Single-doc gets support get().
  const results = await Promise.all(
    batches.map(batch => Promise.all(batch.map(id => getDoc(doc(db, collectionName, id)))))
  )

  const map = new Map<string, any>()
  results.flat().forEach(s => {
    if (s.exists()) map.set(s.id, { id: s.id, ...s.data() })
  })
  return Array.from(map.values())
}

const TLFilterContext = createContext<TLFilterContextType | undefined>(undefined)

export const TLFilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  const [executives, setExecutives] = useState<ExecutiveInfo[]>([])
  const [allCompanies, setAllCompanies] = useState<CompanyInfo[]>([])
  const [selectedExecutiveId, setSelectedExecutiveId] = useState<string | null>(null)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const loadHierarchy = useCallback(async (forceUserId = user?.id) => {
    if (!user || user.role !== 'team-leader' || !forceUserId) return
    setIsLoading(true)
    try {
      const tlDoc = await getDoc(doc(db, 'users', forceUserId))
      if (!tlDoc.exists()) { setIsLoading(false); return }

      const tlData = tlDoc.data()
      const linkedExecIds: string[] = tlData.linkedExecutiveIds || []
      const reportingExecId: string | null = tlData.reportingExecutiveId || null
      const allExecIds = [...new Set([...linkedExecIds, ...(reportingExecId ? [reportingExecId] : [])])]

      if (allExecIds.length === 0) {
        setExecutives([])
        setAllCompanies([])
        setIsLoading(false)
        return
      }

      const execSnap = await getDocsInBatches('users', allExecIds)

      const execList: ExecutiveInfo[] = []
      const allCompanyIds = new Set<string>()
      execSnap.forEach(d => {
        const data = d
        if (data.role === 'executive') {
          const cids: string[] = data.assignedCompanyIds || []
          cids.forEach(id => allCompanyIds.add(id))
          execList.push({
            id: d.id,
            name: data.name || 'Unnamed Executive',
            email: data.email || '',
            assignedCompanyIds: cids,
          })
        }
      })

      setExecutives(execList)

      if (allCompanyIds.size > 0) {
        const compSnap = await getDocsInBatches('companies', [...allCompanyIds])
        const compList: CompanyInfo[] = []
        compSnap.forEach(d => {
          const data = d
          compList.push({ id: d.id, name: data.name || '', code: data.code || '' })
        })
        setAllCompanies(compList)
      } else {
        setAllCompanies([])
      }
    } catch (err) {
      console.error('Error loading TL hierarchy:', err)
    } finally {
      setIsLoading(false)
    }
  }, [user?.id, user?.role])

  useEffect(() => {
    if (!user || user.role !== 'team-leader') {
      setExecutives([])
      setAllCompanies([])
      setSelectedExecutiveId(null)
      setSelectedCompanyId(null)
      setIsLoading(false)
      return
    }
    loadHierarchy(user.id)
  }, [user?.id, user?.role, loadHierarchy])

  // Live-sync the TL's scope so admin reassignments (linked executives /
  // reporting executive) propagate without requiring a reload — replaces the old
  // recompute inside CompanyContext, keeping a single source of truth for TLs.
  useEffect(() => {
    if (!user || user.role !== 'team-leader') return
    const unsub = onSnapshot(
      doc(db, 'users', user.id),
      (snap) => {
        const snapData = snap.data() as any
        const linkedExecIds: string[] = snapData?.linkedExecutiveIds || []
        const reportingExecId: string | null = snapData?.reportingExecutiveId || null
        const allExecIds = [...new Set([...linkedExecIds, ...(reportingExecId ? [reportingExecId] : [])])].sort().join(',')
        const currentIds = [...new Set(executives.map(e => e.id))].sort().join(',')
        if (allExecIds !== currentIds) {
          loadHierarchy(user.id)
        }
      },
      () => { /* silent */ }
    )
    return () => unsub()
  }, [user?.id, user?.role, executives, loadHierarchy])

  const setExecutive = useCallback((id: string) => {
    setSelectedExecutiveId(id)
    setSelectedCompanyId(null)
  }, [])

  const setCompany = useCallback((id: string) => {
    setSelectedCompanyId(id)
  }, [])

  const resetFilters = useCallback(() => {
    setSelectedExecutiveId(null)
    setSelectedCompanyId(null)
  }, [])

  const companies = useMemo(() => {
    if (!selectedExecutiveId) return []
    const exec = executives.find(e => e.id === selectedExecutiveId)
    if (!exec) return []
    return allCompanies.filter(c => exec.assignedCompanyIds.includes(c.id))
  }, [selectedExecutiveId, executives, allCompanies])

  const currentExecutive = useMemo(() => {
    if (!selectedExecutiveId) return null
    return executives.find(e => e.id === selectedExecutiveId) || null
  }, [selectedExecutiveId, executives])

  const currentCompany = useMemo(() => {
    if (!selectedCompanyId) return null
    return allCompanies.find(c => c.id === selectedCompanyId) || null
  }, [selectedCompanyId, allCompanies])

  const isReady = useMemo(() => {
    // Executive selected is enough to be operational — without a specific company
    // the views show the executive's whole portfolio aggregated ("All Companies"
    // within that executive's scope). A company is optional.
    return !!selectedExecutiveId
  }, [selectedExecutiveId])

  const value = useMemo(() => ({
    executives,
    allCompanies,
    companies,
    selectedExecutiveId,
    selectedCompanyId,
    setExecutive,
    setCompany,
    resetFilters,
    isLoading,
    isReady,
    currentExecutive,
    currentCompany,
  }), [executives, allCompanies, companies, selectedExecutiveId, selectedCompanyId, setExecutive, setCompany, resetFilters, isLoading, isReady, currentExecutive, currentCompany])

  return (
    <TLFilterContext.Provider value={value}>
      {children}
    </TLFilterContext.Provider>
  )
}

export { TLFilterContext }

export const useTLFilter = (): TLFilterContextType => {
  const context = useContext(TLFilterContext)
  if (!context) {
    throw new Error('useTLFilter must be used within TLFilterProvider')
  }
  return context
}
