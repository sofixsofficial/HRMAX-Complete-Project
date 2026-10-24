import { useState, useEffect } from 'react'
import { collection, query, where, onSnapshot } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { useAuth } from '../context/AuthContext'

export interface ContingencyInfo {
  isContingencyActive: boolean
  actingForExecutive: { id: string; name: string } | null
  executiveIsInactive: boolean
  executiveCompanyIds: string[]
}

const chunkArray = (ids: string[], size = 10) => {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

export function useContingencyAccess(): ContingencyInfo {
  const { user } = useAuth()
  const [linkedExecutives, setLinkedExecutives] = useState<any[]>([])
  const [anyExecutiveInactive, setAnyExecutiveInactive] = useState(false)

  const isTL = user?.role === 'team-leader'
  const tlData = user as any
  const linkedIds: string[] = tlData?.linkedExecutiveIds || (tlData?.reportingExecutiveId ? [tlData.reportingExecutiveId] : [])
  const tlContingencyEnabled = !!(tlData as any)?.contingencyAccess

  useEffect(() => {
    if (!isTL || linkedIds.length === 0) {
      setLinkedExecutives([])
      setAnyExecutiveInactive(false)
      return
    }

    const batches = chunkArray(linkedIds)
    const combined: any[] = []
    let anyInactive = false
    const unsubs = batches.map(batch => onSnapshot(
      query(collection(db, 'users'), where('__name__', 'in', batch)),
      (snap) => {
        const seen = new Set(combined.map(e => e.id))
        snap.forEach(d => {
          const data = d.data()
          if (!seen.has(d.id)) {
            combined.push({ id: d.id, ...data })
            seen.add(d.id)
          }
          if (data.isActive === false) anyInactive = true
        })
        setLinkedExecutives([...combined])
        setAnyExecutiveInactive(anyInactive)
      },
      () => {
        setLinkedExecutives([...combined])
        setAnyExecutiveInactive(anyInactive)
      }
    ))

    return () => unsubs.forEach(unsub => { try { unsub() } catch {} })
  }, [isTL, linkedIds.join(',')])

  const isContingencyActive = isTL && linkedIds.length > 0 && (tlContingencyEnabled || anyExecutiveInactive)
  const actingForExecutive = isContingencyActive
    ? (() => {
        const inactive = linkedExecutives.find(ex => ex.isActive === false && ex.name)
        if (inactive) return { id: inactive.id, name: inactive.name || 'Unknown' }
        const active = linkedExecutives.find(ex => ex.name)
        if (active) return { id: active.id, name: active.name || 'Unknown' }
        return null
      })()
    : null

  const allCompanyIds: string[] = linkedExecutives.flatMap((ex: any) => ex.assignedCompanyIds || [])
  const executiveCompanyIds = [...new Set(allCompanyIds)]

  return { isContingencyActive, actingForExecutive, executiveIsInactive: anyExecutiveInactive, executiveCompanyIds }
}
