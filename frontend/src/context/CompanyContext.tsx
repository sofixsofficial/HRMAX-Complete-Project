import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore'
import { db } from '../config/firebase'
import { useAuth } from './AuthContext'
import { TLFilterContext } from './TLFilterContext'

interface AssignedCompany {
  id: string
  name: string
  code: string
}

interface CompanyContextType {
  selectedCompanyId: string | null
  setSelectedCompanyId: (id: string) => void
  availableCompanies: AssignedCompany[]
  isCompanyRestricted: boolean
  canAccessAllCompanies: boolean
  isExecutiveWithCompanies: boolean
  isLoading: boolean
  effectiveCompanyId: string | null
  selectedCompanyName: string | null
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined)

export const CompanyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  // Team Leader portfolio/scoping now comes from the (single-source) TL filter
  // context; CompanyContext mirrors it so every page scopes consistently.
  const tlCtx = useContext(TLFilterContext)
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<string | null>(null)
  const [availableCompanies, setAvailableCompanies] = useState<AssignedCompany[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [isReportingManager, setIsReportingManager] = useState(false)

  const isRestrictedRole = user?.role === 'executive' || user?.role === 'team-leader' || isReportingManager

  const isSingleCompanyRole = user?.role === 'company-admin' || user?.role === 'employee'
  const isEmployee = user?.role === 'employee'

  useEffect(() => {
    if (!user) {
      setIsReportingManager(false)
      setAvailableCompanies([])
      setSelectedCompanyIdState(null)
      setIsLoading(false)
      return
    }

    const loadCompanies = async (forceUser: typeof user) => {
      setIsLoading(true)
      try {
        const fuRole = forceUser?.role
        const fuCompanyId = forceUser?.companyId
        const fuId = forceUser?.id

        const fuSingleCompany = fuRole === 'company-admin' || fuRole === 'employee'

        if (fuRole === 'executive') {
          // Executives manage ALL companies (like master-admin): the company
          // dropdown lists every company and defaults to "All Companies" so
          // they can filter & pick any company to manage. assignedCompanyIds is
          // no longer the visibility bound.
          try {
            const allSnap = await getDocs(collection(db, 'companies'))
            const allComps: AssignedCompany[] = allSnap.docs.map(d => {
              const data = d.data()
              return { id: d.id, name: data.name || '', code: data.code || '' }
            })
            setAvailableCompanies(allComps)
            setSelectedCompanyIdState(null)
          } catch {
            setAvailableCompanies([])
            setSelectedCompanyIdState(null)
          }
          setIsLoading(false)
          return
        } else if (fuRole === 'team-leader') {
          // Team Leader scope (availableCompanies + selectedCompanyId) is derived
          // entirely from the TL filter context below — single source of truth.
          // Nothing to fetch here; the derivation effect mirrors it into this
          // context so every page (Attendance/Leaves/Employees/Companies/Dashboards)
          // scopes consistently.
          setIsLoading(false)
          return
        }

        // Reporting Manager (dedicated role): scope strictly to their own company.
        // Unlike the master-admin default branch below, we cannot list all
        // companies (the RM rules only allow per-document reads of their own
        // company), so load via a single getDoc to avoid a permission failure
        // that surfaced as "No companies assigned" in the header.
        if (fuRole === 'reporting-manager') {
          setIsReportingManager(true);
          if (fuCompanyId) {
            try {
              const snap = await getDoc(doc(db, 'companies', fuCompanyId));
              if (snap.exists()) {
                const data = snap.data();
                setAvailableCompanies([{ id: fuCompanyId, name: data.name || '', code: data.code || '' }]);
              } else {
                setAvailableCompanies([{ id: fuCompanyId, name: fuCompanyId, code: '' }]);
              }
            } catch {
              setAvailableCompanies([{ id: fuCompanyId, name: fuCompanyId, code: '' }]);
            }
            setSelectedCompanyIdState(fuCompanyId);
          } else {
            setAvailableCompanies([]);
            setSelectedCompanyIdState(null);
          }
          setIsLoading(false);
          return;
        }

        // Reporting Manager (employee role + isReportingManager flag): fetch
        // employee to check isReportingManager flag
        if (fuRole === 'employee' && fuCompanyId) {
          try {
            const empQuery = query(
              collection(db, 'employees'),
              where('userId', '==', fuId)
            );
            const empSnap = await getDocs(empQuery);
            if (!empSnap.empty) {
              const empData = empSnap.docs[0].data();
              if (empData.isReportingManager === true) {
                setIsReportingManager(true);
                const snap = await getDoc(doc(db, 'companies', fuCompanyId));
                if (snap.exists()) {
                  const data = snap.data();
                  setAvailableCompanies([{ id: fuCompanyId, name: data.name || '', code: data.code || '' }]);
                  setSelectedCompanyIdState(fuCompanyId);
                  setIsLoading(false);
                  return;
                }
              }
            }
          } catch { /* silent */ }
        }

        if (fuSingleCompany && fuCompanyId) {
          // Company-admin or employee: load their own company only
          try {
            const snap = await getDoc(doc(db, 'companies', fuCompanyId))
            if (snap.exists()) {
              const data = snap.data()
              setAvailableCompanies([{ id: fuCompanyId, name: data.name || '', code: data.code || '' }])
            } else {
              // Company doc doesn't exist — use companyId as display name fallback
              setAvailableCompanies([{ id: fuCompanyId, name: fuCompanyId, code: '' }])
            }
          } catch {
            // Firestore read failed (permission / network) — use companyId as fallback
            setAvailableCompanies([{ id: fuCompanyId, name: fuCompanyId, code: '' }])
          }
          setSelectedCompanyIdState(fuCompanyId)
        } else {
          // Master-admin or other unrestricted roles: load all companies for cross-company navigation
          try {
            const allSnap = await getDocs(collection(db, 'companies'))
            const allComps: AssignedCompany[] = allSnap.docs.map(d => {
              const data = d.data()
              return { id: d.id, name: data.name || '', code: data.code || '' }
            })
            setAvailableCompanies(allComps)
          } catch {
            setAvailableCompanies([])
          }
          setSelectedCompanyIdState(fuCompanyId || null)
        }
      } catch (err) {
        console.error('Error loading assigned companies:', err)
        setAvailableCompanies([])
        setSelectedCompanyIdState(forceUser?.companyId || null)
      } finally {
        setIsLoading(false)
      }
    }

    loadCompanies(user)
  }, [user?.id, user?.role, user?.companyId])

  // ── Team Leader scope derivation ─────────────────────────────────────────
  // Single global scope: the TL filter context is authoritative. Map it into
  // availableCompanies / selectedCompanyId so pages reading this context follow
  // the sidebar/header/dashboard selection.
  //   no executive  -> ALL portfolio companies (aggregated "All Companies")
  //   executive only-> that executive's companies aggregated
  //   exec + company -> just the selected company
  const isTeamLeader = user?.role === 'team-leader'
  useEffect(() => {
    if (!isTeamLeader) return
    if (!tlCtx) return
    if (tlCtx.isLoading) {
      setAvailableCompanies([])
      setIsLoading(true)
      return
    }
    const subset = tlCtx.selectedExecutiveId && tlCtx.currentExecutive
      ? tlCtx.allCompanies.filter(c => tlCtx.currentExecutive?.assignedCompanyIds.includes(c.id))
      : tlCtx.allCompanies
    const next = Array.isArray(subset) ? subset : []
    setAvailableCompanies(next)
    // Mirror the TL filter's company selection (null = aggregated within scope).
    setSelectedCompanyIdState(tlCtx.selectedCompanyId || null)
    setIsLoading(false)
  }, [isTeamLeader, tlCtx?.isLoading, tlCtx?.selectedExecutiveId, tlCtx?.selectedCompanyId, tlCtx?.allCompanies, tlCtx?.currentExecutive])

  const setSelectedCompanyId = useCallback((id: string) => {
    // Employee hard-lock: cannot switch companies
    if (user?.role === 'employee') return
    if (isTeamLeader && tlCtx) {
      // Single global scope: route through the TL filter so the sidebar / header /
      // dashboard and every consumer stay synchronized. The derivation effect
      // mirrors it into this context's state.
      tlCtx.setCompany(id || '')
      return
    }
    setSelectedCompanyIdState(id || null)
  }, [user?.role, isTeamLeader, tlCtx])

  const isCompanyRestricted = useMemo(() => {
    return isRestrictedRole && availableCompanies.length > 0
  }, [isRestrictedRole, availableCompanies])

  const canAccessAllCompanies = useMemo(() => {
    // Executives manage all companies (like master-admin).
    return user?.role === 'executive' || (!isRestrictedRole && !isSingleCompanyRole)
  }, [user?.role, isRestrictedRole, isSingleCompanyRole])

  const isExecutiveWithCompanies = useMemo(() => {
    return user?.role === 'executive' && availableCompanies.length > 0
  }, [user?.role, availableCompanies])

  const effectiveCompanyId = useMemo(() => {
    // Employee: always use their pre-assigned companyId — never depends on selector
    if (user?.role === 'employee') return user.companyId || null
    if (isRestrictedRole) {
      return selectedCompanyId
    }
    // For unrestricted roles (master-admin, company-admin), use the actively
    // selected company from the dropdown when available, falling back to user.companyId.
    // This ensures in-page dropdown changes trigger data re-fetches.
    if (selectedCompanyId) return selectedCompanyId
    return user?.companyId || null
  }, [user?.role, user?.companyId, isRestrictedRole, selectedCompanyId])

  useEffect(() => {
    if (!user) { setCompanyName(null); return }
    const cid = effectiveCompanyId || user?.companyId
    if (!cid) { setCompanyName(null); return }
    // First: check availableCompanies (already loaded by loadCompanies)
    const found = availableCompanies.find(c => c.id === cid)
    if (found) { setCompanyName(found.name); return }
    // Fallback: direct Firestore read for company name
    getDoc(doc(db, 'companies', cid)).then(snap => {
      if (snap.exists()) setCompanyName(snap.data()?.name || null)
    }).catch(() => {})
  }, [user, effectiveCompanyId, isRestrictedRole, availableCompanies])

  const selectedCompanyName = useMemo(() => {
    const comp = availableCompanies.find(c => c.id === selectedCompanyId)
    if (comp) return comp.name
    // Restricted roles (executive / team-leader / RM) operating in
    // "All Companies" mode must NOT display the user's own company as if it
    // were the active selection — show nothing instead.
    if (isRestrictedRole) {
      if (selectedCompanyId && effectiveCompanyId) {
        const sel = availableCompanies.find(c => c.id === effectiveCompanyId)
        if (sel) return sel.name
      }
      return null
    }
    return companyName || null
  }, [availableCompanies, selectedCompanyId, companyName, isRestrictedRole, effectiveCompanyId])

  const value = useMemo(() => ({
    selectedCompanyId,
    setSelectedCompanyId,
    availableCompanies,
    isCompanyRestricted,
    canAccessAllCompanies,
    isExecutiveWithCompanies,
    isLoading,
    effectiveCompanyId,
    selectedCompanyName,
  }), [selectedCompanyId, setSelectedCompanyId, availableCompanies, isCompanyRestricted, canAccessAllCompanies, isExecutiveWithCompanies, isLoading, effectiveCompanyId, selectedCompanyName])

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  )
}

export const useCompany = () => {
  const context = useContext(CompanyContext)
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider')
  }
  return context
}
