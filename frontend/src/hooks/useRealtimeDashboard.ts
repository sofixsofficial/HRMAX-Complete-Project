import { useState, useEffect, useRef } from 'react'
import { collection, query, where, onSnapshot, type FirestoreError } from 'firebase/firestore'
import { db } from '../firebase/config'
import { isDate } from '../utils/dateUtils'
import { isActiveMissedPunchRecord, recentMissPunchSinceDate } from '../utils/attendanceStatus'
import { buildScopedQuery } from '../services/scopedQueries'
import { useAuth } from '../context/AuthContext'

interface DashboardData {
  totalCompanies: number;
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  presentToday: number;
  absentToday: number;
  lateToday: number;
  missPunchToday: number;
  onLeaveToday: number;
  totalAttendance: number;
  upcomingHolidays: number;
  todayBirthdays: number;
  pendingTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  overdueTasks: number;
  salaryGenerated: number;
  totalDepartments: number;
  totalExecutives: number;
  totalTeamLeaders: number;
  pendingLeaves: number;
  approvedLeaves: number;
  totalRoles: number;
  activeRoles: number;
  totalCompanyAdmins: number;
  pendingCompanyAdmins: number;
  approvedCompanyAdmins: number;
  rejectedCompanyAdmins: number;
  suspendedCompanyAdmins: number;
  loading: boolean;
}

const initialData: DashboardData = {
  totalCompanies: 0, totalEmployees: 0, activeEmployees: 0, inactiveEmployees: 0,
  presentToday: 0, absentToday: 0, lateToday: 0, missPunchToday: 0, onLeaveToday: 0,
  totalAttendance: 0, upcomingHolidays: 0, todayBirthdays: 0,
  pendingTasks: 0, completedTasks: 0, inProgressTasks: 0, overdueTasks: 0,
  salaryGenerated: 0, totalDepartments: 0,
  totalExecutives: 0, totalTeamLeaders: 0, pendingLeaves: 0, approvedLeaves: 0,
  totalRoles: 0, activeRoles: 0,
  totalCompanyAdmins: 0, pendingCompanyAdmins: 0, approvedCompanyAdmins: 0, rejectedCompanyAdmins: 0, suspendedCompanyAdmins: 0,
  loading: true
}

export function useRealtimeDashboard(companyId?: string | null): DashboardData {
  const [data, setData] = useState<DashboardData>(initialData)
  const loadedCount = useRef(0)
  const expectedListeners = useRef(0)

  const markLoaded = () => {
    loadedCount.current += 1
    if (expectedListeners.current > 0 && loadedCount.current >= expectedListeners.current) {
      setData(prev => ({ ...prev, loading: false }))
    }
  }

  const { user } = useAuth()

  useEffect(() => {
    if (!user) {
      setData(prev => ({ ...prev, loading: false }))
      return () => {}
    }

    const unsubscribers: (() => void)[] = []
    loadedCount.current = 0
    expectedListeners.current = 0

    const now = new Date()
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)

    const listen = (
      ref: ReturnType<typeof collection> | ReturnType<typeof query>,
      onNext: (snapshot: any) => void,
      onError?: (err: FirestoreError) => void
    ) => {
      let completed = false
      const done = () => {
        if (!completed) { completed = true; markLoaded() }
      }
      return onSnapshot(
        ref as any,
        (snapshot: any) => { done(); onNext(snapshot) },
        (err: FirestoreError) => {
          console.error('[useRealtimeDashboard] onSnapshot error:', err?.message || err)
          done()
          onError?.(err)
        }
      )
    }

    const listenQ = listen

    const listRef = (colName: string) =>
      buildScopedQuery({
        collectionName: colName,
        user,
        companyIds: companyId ? [companyId] : undefined,
      })
    const companyFilter = companyId ? where('companyId', '==', companyId) : undefined

    const companiesRef = companyId
      ? query(collection(db, 'companies'), where('__name__', '==', companyId))
      : collection(db, 'companies')
    const unsubCompanies = listen(companiesRef, (snapshot) => {
      setData(prev => ({ ...prev, totalCompanies: snapshot.size }))
    })
    unsubscribers.push(unsubCompanies)

    const unsubEmployees = listen(listRef('employees'), (snapshot) => {
      const docs = snapshot.docs.map((d: any) => d.data())
      const active = docs.filter((d: any) => d.status === 'Active').length
      const inactive = docs.filter((d: any) => d.status === 'Inactive').length
      const onLeave = docs.filter((d: any) => d.status === 'On Leave').length
      const todayBday = docs.filter((e: any) => {
        if (!e.birthDate && !e.dob) return false
        const bd = isDate(e.birthDate) ? e.birthDate : e.birthDate?.toDate ? e.birthDate.toDate() : isDate(e.dob) ? e.dob : e.dob?.toDate ? e.dob.toDate() : new Date(e.birthDate || e.dob)
        if (isNaN(bd.getTime())) return false
        return bd.getMonth() === now.getMonth() && bd.getDate() === now.getDate()
      }).length
      setData(prev => ({ ...prev, totalEmployees: docs.length, activeEmployees: active, inactiveEmployees: inactive, onLeaveToday: onLeave, todayBirthdays: todayBday }))
    })
    unsubscribers.push(unsubEmployees)

    const attendanceConstraints = [where('date', '>=', startOfDay), where('date', '<=', endOfDay)]
    if (companyFilter) attendanceConstraints.push(companyFilter)
    const unsubAttendanceToday = listenQ(
      query(collection(db, 'attendance'), ...attendanceConstraints),
      (snapshot) => {
        const docs = snapshot.docs.map((d: any) => d.data())
        const isApprovedOrPresent = (d: any) =>
          d.status === 'Approved' || d.status === 'Present'
        setData(prev => ({
          ...prev,
          presentToday: docs.filter((d: any) => isApprovedOrPresent(d)).length,
          absentToday: docs.filter((d: any) => d.status === 'Absent').length,
          lateToday: docs.filter((d: any) => d.status === 'Late').length,
          onLeaveToday: docs.filter((d: any) => d.status === 'On Leave' || d.status === 'OnLeave').length,
          totalAttendance: docs.length
        }))
      }
    )
    unsubscribers.push(unsubAttendanceToday)

    // Missed-punch figures aggregate ACTIVE records across a 14-day window
    // (not just today): pending rectifications spanning prior days and status
    // tokens like 'miss_punch'/'MissPunch'/'miss-punch' are all counted via the
    // shared isActiveMissedPunchRecord predicate.
    const missPunchSince = recentMissPunchSinceDate(now)
    const missPunchConstraints = [where('date', '>=', missPunchSince)]
    if (companyFilter) missPunchConstraints.push(companyFilter)
    const unsubMissPunch = listenQ(
      query(collection(db, 'attendance'), ...missPunchConstraints),
      (snapshot) => {
        const docs = snapshot.docs.map((d: any) => d.data())
        setData(prev => ({
          ...prev,
          missPunchToday: docs.filter((d: any) => isActiveMissedPunchRecord(d)).length
        }))
      }
    )
    unsubscribers.push(unsubMissPunch)

    const unsubHolidays = listen(listRef('holidays'), (snapshot) => {
      const docs = snapshot.docs.map((d: any) => d.data())
      const upcomingHol = docs.filter((h: any) => {
        const d = isDate(h.date) ? h.date : h.date?.toDate ? h.date.toDate() : new Date(h.date)
        return !isNaN(d.getTime()) && d >= now
      }).length
      setData(prev => ({ ...prev, upcomingHolidays: upcomingHol }))
    })
    unsubscribers.push(unsubHolidays)

    const unsubLeaves = listen(listRef('leaveRequests'), (snapshot) => {
      const docs = snapshot.docs.map((d: any) => d.data())
      setData(prev => ({
        ...prev,
        pendingLeaves: docs.filter((d: any) => d.status === 'Pending').length,
        approvedLeaves: docs.filter((d: any) => d.status === 'Approved').length
      }))
    })
    unsubscribers.push(unsubLeaves)

    const unsubTasks = listen(listRef('tasks'), (snapshot) => {
      const docs = snapshot.docs.map((d: any) => d.data())
      setData(prev => ({
        ...prev,
        pendingTasks: docs.filter((d: any) => d.status === 'Pending' || d.status === 'pending').length,
        completedTasks: docs.filter((d: any) => d.status === 'Completed' || d.status === 'completed').length,
        inProgressTasks: docs.filter((d: any) => d.status === 'In Progress' || d.status === 'inProgress' || d.status === 'in-progress').length,
        overdueTasks: docs.filter((d: any) => d.status === 'Overdue' || d.status === 'overdue').length
      }))
    })
    unsubscribers.push(unsubTasks)

    const unsubUsers = listen(listRef('users'), (snapshot) => {
      const docs = snapshot.docs.map((d: any) => d.data())
      setData(prev => ({
        ...prev,
        totalExecutives: docs.filter((u: any) => u.role === 'executive').length,
        totalTeamLeaders: docs.filter((u: any) => u.role === 'team-leader').length
      }))
    })
    unsubscribers.push(unsubUsers)

    const unsubDepartments = listen(listRef('departments'), (snapshot) => {
      setData(prev => ({ ...prev, totalDepartments: snapshot.size }))
    })
    unsubscribers.push(unsubDepartments)

    const unsubSalary = listen(listRef('salarySlips'), (snapshot) => {
      setData(prev => ({ ...prev, salaryGenerated: snapshot.size }))
    })
    unsubscribers.push(unsubSalary)

    const unsubRoles = listen(listRef('roles'), (snapshot) => {
      const docs = snapshot.docs.map((d: any) => d.data())
      setData(prev => ({
        ...prev,
        totalRoles: docs.length,
        activeRoles: docs.filter((r: any) => r.status === 'active' || r.isActive === true).length
      }))
    })
    unsubscribers.push(unsubRoles)

    const unsubCompanyAdmins = listen(collection(db, 'users'), (snapshot) => {
      const docs = snapshot.docs.map((d: any) => d.data())
      const admins = docs.filter((u: any) => u.role === 'company-admin')
      setData(prev => ({
        ...prev,
        totalCompanyAdmins: admins.length,
        pendingCompanyAdmins: admins.filter((a: any) => (a.status || 'Pending') === 'Pending').length,
        approvedCompanyAdmins: admins.filter((a: any) => a.status === 'Approved').length,
        rejectedCompanyAdmins: admins.filter((a: any) => a.status === 'Rejected').length,
        suspendedCompanyAdmins: admins.filter((a: any) => a.status === 'Suspended').length,
      }))
    })
    unsubscribers.push(unsubCompanyAdmins)

    // Register the exact listener count AFTER attaching every listener so the
    // loading gate matches subscriptions actually created (previously a hard-
    // coded 13 vs 11 real listeners kept loading on forever and the dashboard
    // fell into its 10s "session expired" fallback on every load).
    expectedListeners.current = unsubscribers.length

    const timeout = setTimeout(() => {
      const pending = expectedListeners.current - loadedCount.current
      if (pending > 0) {
        console.warn(`[useRealtimeDashboard] ${pending} listener(s) never fired after 15s`)
        loadedCount.current = expectedListeners.current
        setData(prev => ({ ...prev, loading: false }))
      }
    }, 15000)

    return () => {
      clearTimeout(timeout)
      unsubscribers.forEach(unsub => { try { unsub() } catch {} })
    }
  }, [companyId])

  return data
}
