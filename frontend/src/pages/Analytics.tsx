import { useState, useEffect } from 'react'
import {
  TrendingUp, Users, CheckSquare, Clock, Loader2, Calendar
} from 'lucide-react'
import { collection, query, where, getDocs } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import type { AttendanceRecord } from '../types/user'

export function Analytics() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const isTeamLeader = user?.role === 'team-leader'
  const companyId = user?.companyId || ''
  const departmentId = user?.departmentId

  const [metrics, setMetrics] = useState({
    totalAttendance: 0,
    avgWorkHours: 0,
    completionRate: 0,
    leaveUtilization: 0,
    totalTasks: 0,
    departmentHeadcount: 0,
    groupComparison: [] as { label: string; value: number }[],
  })

  useEffect(() => {
    loadAnalytics()
  }, [companyId, departmentId])

  const loadAnalytics = async () => {
    try {
      setLoading(true)
      if (!companyId) { setLoading(false); return }

      let employeeIds: string[] = []
      let employees: any[] = []
      let tasks: any[] = []
      let records: any[] = []
      let leaves: any[] = []

      if (isTeamLeader && departmentId) {
        const [empSnap, taskSnap] = await Promise.all([
          getDocs(query(collection(db, 'employees'), where('departmentId', '==', departmentId))),
          getDocs(query(collection(db, 'tasks'), where('departmentId', '==', departmentId))),
        ])
        employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        tasks = taskSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        employeeIds = employees.map(e => e.userId || e.id)

        if (employeeIds.length > 0) {
          const [attSnap, leaveSnap] = await Promise.all([
            getDocs(query(collection(db, 'attendance'), where('companyId', '==', companyId))),
            getDocs(query(collection(db, 'leaveRequests'), where('companyId', '==', companyId))),
          ])
          const allRecords = attSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))
          const allLeaves = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() } as any))
          records = allRecords.filter((r: any) => employeeIds.includes(r.userId))
          leaves = allLeaves.filter((l: any) => employeeIds.includes(l.userId))
        }
      } else {
        const [attSnap, taskSnap, leaveSnap, empSnap] = await Promise.all([
          getDocs(query(collection(db, 'attendance'), where('companyId', '==', companyId))),
          getDocs(query(collection(db, 'tasks'), where('companyId', '==', companyId))),
          getDocs(query(collection(db, 'leaveRequests'), where('companyId', '==', companyId))),
          getDocs(query(collection(db, 'employees'), where('companyId', '==', companyId))),
        ])
        records = attSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        tasks = taskSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        leaves = leaveSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        employeeIds = employees.map((e: any) => e.userId || e.id)
      }

      const completed = tasks.filter((t: any) => t.status === 'Completed' || t.status === 'done').length
      const total = tasks.length
      const workHours = records.reduce((sum: number, r: any) => sum + (r.workHours || 0), 0)
      const usedLeaves = leaves.filter((l: any) => l.status === 'Approved').length

      const deptMap: Record<string, number> = {}
      employees.forEach((e: any) => {
        if (e.department) {
          deptMap[e.department] = (deptMap[e.department] || 0) + 1
        }
      })

      setMetrics({
        totalAttendance: records.length,
        avgWorkHours: records.length > 0 ? Math.round((workHours / records.length) * 10) / 10 : 0,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        leaveUtilization: employees.length > 0 ? Math.round((usedLeaves / employees.length) * 100) : 0,
        totalTasks: total,
        departmentHeadcount: employees.length,
        groupComparison: Object.entries(deptMap).map(([label, value]) => ({ label, value })),
      })
    } catch (err) {
      console.error('Analytics load error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Analytics" />
        <div className="page-content">
          <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading analytics...</p></div>
        </div>
      </div>
    )
  }

  const topCards = [
    { icon: Users, label: 'Team Size', value: metrics.departmentHeadcount, color: '#f97316' },
    { icon: Clock, label: 'Attendance Records', value: metrics.totalAttendance, color: '#10b981' },
    { icon: Clock, label: 'Avg Work Hours', value: `${metrics.avgWorkHours}h`, color: '#f59e0b' },
    { icon: CheckSquare, label: 'Task Completion', value: `${metrics.completionRate}%`, color: '#8b5cf6' },
    { icon: CheckSquare, label: 'Total Tasks', value: metrics.totalTasks, color: '#06b6d4' },
    { icon: Calendar, label: 'Leave Utilization', value: `${metrics.leaveUtilization}%`, color: '#ec4899' },
  ]

  return (
    <div className="page-container">
      <Header title={isTeamLeader ? 'Team Analytics' : 'Analytics'} />
      <div className="page-content">
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          {topCards.map((card, i) => (
            <div key={i} className="stat-card">
              <div className="stat-icon"><card.icon size={24} style={{ color: card.color }} /></div>
              <div className="stat-info">
                <span className="stat-label">{card.label}</span>
                <div className="stat-value">{card.value}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #f3f4f6', padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
            {isTeamLeader ? 'Team Distribution' : 'Department Distribution'}
          </h3>
          {metrics.groupComparison.length === 0 ? (
            <p style={{ color: '#9ca3af', fontSize: 14 }}>No data available</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {metrics.groupComparison.map((item, i) => {
                const max = Math.max(...metrics.groupComparison.map(d => d.value), 1)
                const pct = (item.value / max) * 100
                return (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span style={{ color: '#374151', fontWeight: 500 }}>{item.label}</span>
                      <span style={{ color: '#6b7280' }}>{item.value}</span>
                    </div>
                    <div style={{ height: 8, background: '#f3f4f6', borderRadius: 100 }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: '#f97316', borderRadius: 100, transition: 'width 0.3s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
