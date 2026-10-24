import { useState, useEffect, useRef } from 'react'
import { collection, query, where, onSnapshot, type FirestoreError } from '../aws/firestore-compat'
import { auth, db } from '../aws/clients'
import { isDate } from '../utils/dateUtils'
import { getActionableLeaveTier } from '../services/leaveService'
import { useAuth } from '../context/AuthContext'

export interface TeamDashboardStats {
  totalTeamMembers: number
  activeTeamMembers: number
  presentToday: number
  absentToday: number
  lateToday: number
  onLeaveToday: number
  pendingTasks: number
  inProgressTasks: number
  completedTasks: number
  pendingLeaves: number
  approvedLeaves: number
  performanceScore: number
  announcements: number
  upcomingHolidays: number
  todayBirthdays: number
}

function isToday(date: Date): boolean {
  const now = new Date()
  return date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
}

function getDateValue(value: any): Date | null {
  if (!value) return null
  if (isDate(value)) return value
  if (value.toDate) return value.toDate()
  if (typeof value === 'string') return new Date(value)
  return null
}

const initialStats: TeamDashboardStats = {
  totalTeamMembers: 0,
  activeTeamMembers: 0,
  presentToday: 0,
  absentToday: 0,
  lateToday: 0,
  onLeaveToday: 0,
  pendingTasks: 0,
  inProgressTasks: 0,
  completedTasks: 0,
  pendingLeaves: 0,
  approvedLeaves: 0,
  performanceScore: 0,
  announcements: 0,
  upcomingHolidays: 0,
  todayBirthdays: 0,
}

// Firestore caps `in` at 10 values, so split into chunked queries and merge.
function chunkArray(arr: string[], size = 10): string[][] {
  const out: string[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export function useTeamDashboardStats(
  companyId?: string | string[] | null,
  departmentId?: string | null,
): TeamDashboardStats & { loading: boolean } {
  const [stats, setStats] = useState<TeamDashboardStats>(initialStats)
  const [loading, setLoading] = useState(true)
  const teamMemberIds = useRef<string[]>([])
  const loadedCount = useRef(0)
  const totalListeners = useRef(6)

  const { user } = useAuth()

  const markLoaded = () => {
    loadedCount.current += 1
    if (loadedCount.current >= totalListeners.current) {
      setLoading(false)
    }
  }

  useEffect(() => {
    const companyIds = Array.isArray(companyId)
      ? companyId
      : (companyId ? [companyId] : [])

    if (!auth.currentUser || companyIds.length === 0) {
      setLoading(false)
      return
    }

    loadedCount.current = 0
    teamMemberIds.current = []
    const now = new Date()
    const unsubscribers: (() => void)[] = []

    // Listen to a collection across every company id, chunking the `in`
    // filter (Firestore caps at 10) and merging results so that no assigned
    // company beyond 10 is silently dropped from the counts.
    const listenScoped = (colName: string, ids: string[], onDocs: (docs: any[]) => void) => {
      const chunks = chunkArray(ids)
      const docMap: Record<string, any> = {}
      let reported = false
      // Track which chunks have fired; report once all have.
      const pending = new Set(chunks.map((_, i) => i))
      const settle = (idx: number) => {
        pending.delete(idx)
        if (pending.size === 0) {
          if (!reported) { reported = true; markLoaded() }
          onDocs(Object.values(docMap))
        }
      }
      const unsubs = chunks.map((chunk, idx) => {
        const ref = query(collection(db, colName), where('companyId', 'in', chunk))
        const snapHandler = (snap: any) => {
          snap.docs.forEach((d: any) => { docMap[d.id] = { id: d.id, ...d.data() } })
          settle(idx)
        }
        return onSnapshot(ref, snapHandler, (err: FirestoreError) => {
          console.error(`[useTeamDashboardStats] ${colName} chunk error:`, err?.message || err)
          settle(idx)
        })
      })
      return () => unsubs.forEach(u => { try { u() } catch {} })
    }

    // 1. Employees by department (team members) — company-scoped or department-scoped
    const unsubEmployees = listenScoped('employees', companyIds, (docs) => {
      // apply department filter client-side when departmentId is set
      const scoped = departmentId ? docs.filter((e: any) => e.departmentId === departmentId) : docs
      teamMemberIds.current = scoped.map((d: any) => d.userId).filter(Boolean)
      const todayBdays = scoped.filter((e: any) => {
        const dob = getDateValue(e.birthDate || e.dob)
        return dob ? isToday(dob) : false
      }).length
      setStats(prev => ({
        ...prev,
        totalTeamMembers: scoped.length,
        activeTeamMembers: scoped.filter((d: any) => d.status === 'Active').length,
        onLeaveToday: scoped.filter((d: any) => d.status === 'On Leave').length,
        todayBirthdays: todayBdays,
      }))
    })
    unsubscribers.push(unsubEmployees)

    // 2. Attendance (company-scoped, filtered client-side to team members)
    const unsubAttendance = listenScoped('attendance', companyIds, (docs) => {
      const todayStr = now.toISOString().split('T')[0]
      const ids = teamMemberIds.current
      const todayRecords = docs.filter((d: any) => {
        if (!ids.includes(d.userId)) return false
        const date = d.date
        if (!date) return false
        if (typeof date === 'string') return date.startsWith(todayStr)
        const dDate = getDateValue(date)
        return dDate ? isToday(dDate) : false
      })
      setStats(prev => ({
        ...prev,
        presentToday: todayRecords.filter((d: any) => d.status === 'Present').length,
        absentToday: todayRecords.filter((d: any) => d.status === 'Absent').length,
        lateToday: todayRecords.filter((d: any) => d.status === 'Late').length,
      }))
    })
    unsubscribers.push(unsubAttendance)

    // 3. Tasks (company-scoped, filtered client-side to team members) — also department filter
    const unsubTasks = listenScoped('tasks', companyIds, (docs) => {
      const scoped = departmentId ? docs.filter((d: any) => d.departmentId === departmentId) : docs
      const pending = scoped.filter((d: any) => d.status === 'Pending').length
      const inProgress = scoped.filter((d: any) => d.status === 'In Progress' || d.status === 'inProgress').length
      const completed = scoped.filter((d: any) => d.status === 'Completed' || d.status === 'done').length
      setStats(prev => ({
        ...prev,
        pendingTasks: pending,
        inProgressTasks: inProgress,
        completedTasks: completed,
        performanceScore: (pending + completed) > 0
          ? Math.round((completed / (pending + completed)) * 100)
          : 0,
      }))
    })
    unsubscribers.push(unsubTasks)

    // 4. Leaves (company-scoped, filtered client-side to team members; the
    // pending count reflects only requests awaiting THIS TL's decision)
    const unsubLeaves = listenScoped('leaveRequests', companyIds, (docs) => {
      const ids = teamMemberIds.current
      const teamLeaves = docs.filter((d: any) => ids.includes(d.userId))
      setStats(prev => ({
        ...prev,
        pendingLeaves: teamLeaves.filter((d: any) => d.status === 'Pending' && getActionableLeaveTier(d, user?.id || '', user?.role, companyIds)).length,
        approvedLeaves: teamLeaves.filter((d: any) => d.status === 'Approved').length,
      }))
    })
    unsubscribers.push(unsubLeaves)

    // 5. Announcements + Holidays (company-wide)
    const unsubAnnouncements = listenScoped('announcements', companyIds, (docs) => {
      setStats(prev => ({ ...prev, announcements: docs.length }))
    })
    unsubscribers.push(unsubAnnouncements)

    const unsubHolidays = listenScoped('holidays', companyIds, (docs) => {
      // Match the HolidayCalendar destination (current calendar year) so the
      // card count equals the list it opens.
      const upcoming = docs.filter((d: any) => {
        const date = getDateValue(d.date)
        return date ? date.getFullYear() === now.getFullYear() : false
      }).length
      setStats(prev => ({ ...prev, upcomingHolidays: upcoming }))
    })
    unsubscribers.push(unsubHolidays)

    totalListeners.current = 6

    const timeout = setTimeout(() => {
      if (loadedCount.current < totalListeners.current) {
        loadedCount.current = totalListeners.current
        setLoading(false)
      }
    }, 15000)

    return () => {
      clearTimeout(timeout)
      unsubscribers.forEach(u => { try { u() } catch {} })
    }
  }, [companyId, departmentId, user?.id, user?.role])

  return { ...stats, loading }
}
