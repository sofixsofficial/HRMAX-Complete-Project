import { useState, useEffect, useCallback } from 'react'
import {
  BarChart3, Download, Search, Loader2, Clock, CheckCircle, XCircle,
  AlertCircle, ChevronLeft, ChevronRight, MapPin, Users, User,
  Activity, TrendingUp, PieChart
} from 'lucide-react'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { getAttendanceByCompany, subscribeTodayAttendanceByCompany } from '../services/attendanceService'
import { getAttendancePolicy } from '../services/attendanceSettingsService'
import { getEmployeesByCompany } from '../services/employeeService'
import { isDate } from '../utils/dateUtils'
import type { AttendanceRecord, Employee } from '../types/user'
import type { AttendancePolicy, EmployeeAttendanceStats } from '../types/attendance'
import './Dashboard.css'

const statusStyle: Record<string, { bg: string; text: string; icon: any }> = {
  'Approved': { bg: '#dcfce7', text: '#16a34a', icon: CheckCircle },
  'Present': { bg: '#dcfce7', text: '#16a34a', icon: CheckCircle },
  'Absent': { bg: '#fee2e2', text: '#ef4444', icon: XCircle },
  'Late': { bg: '#fef3c7', text: '#f59e0b', icon: AlertCircle },
  'On Leave': { bg: '#eff6ff', text: '#2563eb', icon: Clock },
  'Miss Punch': { bg: '#f3e8ff', text: '#9333ea', icon: AlertCircle },
  'Early Checkout': { bg: '#fff7ed', text: '#f97316', icon: Activity },
}

const formatTime = (d: Date | null | undefined) => {
  if (!d) return '--:--'
  const date = (d as any)?.toDate ? (d as any).toDate() : isDate(d) ? d : new Date(d)
  if (isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

const formatDate = (d: Date | null | undefined) => {
  if (!d) return ''
  const date = (d as any)?.toDate ? (d as any).toDate() : isDate(d) ? d : new Date(d)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

type DashboardTab = 'overview' | 'employees'

export function AttendanceDashboard() {
  const { user } = useAuth()
  const { effectiveCompanyId, selectedCompanyName } = usePermissionScope('attendance')
  const companyId = effectiveCompanyId || user?.companyId || ''

  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [isSwitchingCompany, setIsSwitchingCompany] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [policy, setPolicy] = useState<AttendancePolicy | null>(null)
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview')
  const [empStatsPage, setEmpStatsPage] = useState(1)
  const [empStatsSearch, setEmpStatsSearch] = useState('')

  const todayStart = useCallback(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  const todayEnd = useCallback(() => {
    const d = new Date(); d.setHours(23, 59, 59, 999); return d
  }, [])

  useEffect(() => {
    if (!companyId) return
    setIsSwitchingCompany(true)
    const unsub = subscribeTodayAttendanceByCompany(companyId, (data) => {
      setRecords(data)
      setLoading(false)
      setIsSwitchingCompany(false)
    })
    return () => unsub()
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    getAttendanceByCompany(companyId).then(data => {
      setAllRecords(data)
    }).catch(() => {})
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    getAttendancePolicy(companyId).then(setPolicy).catch(() => {})
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    getEmployeesByCompany(companyId).then(emps => {
      setEmployees(emps)
    }).catch(() => {})
  }, [companyId])

  const dateFiltered = allRecords.filter(r => {
    const d = isDate(r.date) ? r.date : new Date(r.date)
    const s = new Date(startDate)
    const e = new Date(endDate)
    e.setHours(23, 59, 59, 999)
    return d >= s && d <= e
  })

  const filtered = dateFiltered.filter(r => {
    const q = searchTerm.toLowerCase()
    const matchesSearch = r.name?.toLowerCase().includes(q) || r.department?.toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'All' || r.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const present = records.filter(r => r.status === 'Present' || r.status === 'Approved')
  const late = records.filter(r => r.status === 'Late')
  const absent = employees.filter(e => {
    const hasRecord = records.some(r => r.userId === e.userId)
    return !hasRecord || records.some(r => r.userId === e.userId && r.status === 'Absent')
  })
  const onLeave = records.filter(r => r.status === 'On Leave')
  const missPunch = records.filter(r => r.status === 'Miss Punch')
  const avgHours = records.length > 0
    ? records.reduce((sum, r) => sum + (r.workHours || 0), 0) / records.length
    : 0

  const summaryCards = [
    { label: 'Present', count: present.length, color: '#16a34a', bg: '#dcfce7', icon: CheckCircle },
    { label: 'Late', count: late.length, color: '#f59e0b', bg: '#fef3c7', icon: AlertCircle },
    { label: 'Absent', count: absent.length, color: '#ef4444', bg: '#fee2e2', icon: XCircle },
    { label: 'On Leave', count: onLeave.length, color: '#2563eb', bg: '#eff6ff', icon: Clock },
    { label: 'Miss Punch', count: missPunch.length, color: '#9333ea', bg: '#f3e8ff', icon: AlertCircle },
  ]

  const exportCsv = () => {
    const headers = ['Employee', 'Department', 'Date', 'Check In', 'Check Out', 'Status', 'Hours', 'Overtime']
    const rows = filtered.map(r => [
      r.name, r.department, formatDate(r.date), formatTime(r.checkIn), formatTime(r.checkOut),
      r.status, r.workHours?.toFixed(1) || '0', r.overtimeHours?.toFixed(1) || '0'
    ])
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `attendance_${new Date().toISOString().slice(0, 10)}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const trendData = (() => {
    const days: { label: string; present: number; late: number; absent: number; total: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })
      const dayRecords = allRecords.filter(r => {
        const rd = isDate(r.date) ? r.date : new Date(r.date)
        return rd.toDateString() === d.toDateString()
      })
      const dayEmployees = employees.filter(e => {
        const hasRec = dayRecords.some(r => r.userId === e.userId)
        return hasRec || true
      })
      days.push({
        label: dayStr,
        present: dayRecords.filter(r => r.status === 'Present' || r.status === 'Approved').length,
        late: dayRecords.filter(r => r.status === 'Late').length,
        absent: dayEmployees.length - dayRecords.filter(r => r.status === 'Present' || r.status === 'Approved' || r.status === 'Late' || r.status === 'On Leave').length,
        total: dayEmployees.length,
      })
    }
    return days
  })()

  const maxTrend = Math.max(...trendData.map(d => d.total), 1)

  const empStats: EmployeeAttendanceStats[] = employees.map(emp => {
    const empRecs = dateFiltered.filter(r => r.userId === emp.userId)
    const presentDays = empRecs.filter(r => r.status === 'Present' || r.status === 'Approved').length
    const lateDays = empRecs.filter(r => r.status === 'Late').length
    const absentDays = empRecs.filter(r => r.status === 'Absent').length
    const approvedLeaveDays = empRecs.filter(r => r.status === 'On Leave').length
    const missPunchDays = empRecs.filter(r => r.status === 'Miss Punch').length
    const totalDays = empRecs.length || 1
    const attendancePercentage = totalDays > 0 ? ((presentDays + lateDays) / totalDays) * 100 : 0
    return {
      userId: emp.userId,
      employeeName: emp.name,
      employeeId: emp.employeeId,
      department: emp.department,
      presentDays,
      lateDays,
      absentDays,
      approvedLeaveDays,
      missPunchDays,
      totalWorkingHours: empRecs.reduce((s, r) => s + (r.workHours || 0), 0),
      totalOvertimeHours: empRecs.reduce((s, r) => s + (r.overtimeHours || 0), 0),
      attendancePercentage: Math.round(attendancePercentage * 10) / 10,
    }
  })

  const filteredEmpStats = empStats.filter(e => {
    const q = empStatsSearch.toLowerCase()
    return e.employeeName.toLowerCase().includes(q) || e.employeeId.toLowerCase().includes(q) || e.department.toLowerCase().includes(q)
  })

  const totalEmpStatsPages = Math.ceil(filteredEmpStats.length / pageSize)
  const paginatedEmpStats = filteredEmpStats.slice((empStatsPage - 1) * pageSize, empStatsPage * pageSize)

  if (loading || isSwitchingCompany) {
    return (
      <div className="page-container">
        <Header title="Attendance Dashboard" />
        <div className="page-content">
          <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>{isSwitchingCompany ? `Loading data for ${selectedCompanyName || 'selected company'}...` : 'Loading dashboard...'}</p></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Attendance Dashboard" />
      <div className="page-content">

        <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }} />
              <input type="text" placeholder="Search employees..." value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 14, outline: 'none' }} />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              style={{ padding: '10px 36px 10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', fontSize: 14, outline: 'none' }}>
              <option value="All">All Status</option>
              <option value="Present">Present</option>
              <option value="Late">Late</option>
              <option value="Absent">Absent</option>
              <option value="On Leave">On Leave</option>
              <option value="Miss Punch">Miss Punch</option>
            </select>
          </div>
          <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setCurrentPage(1) }}
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, outline: 'none' }} />
          <span style={{ color: '#9ca3af' }}>to</span>
          <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setCurrentPage(1) }}
            style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, outline: 'none' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={exportCsv}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              <Download size={16} /> Export CSV
            </button>
          </div>
        </div>

        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card stat-card-dark">
            <div className="stat-icon"><Users size={24} color="#fb923c" /></div>
            <div className="stat-info">
              <span className="stat-label">Total Employees</span>
              <div className="stat-value">{employees.length}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><CheckCircle size={24} color="#16a34a" /></div>
            <div className="stat-info">
              <span className="stat-label">Present</span>
              <div className="stat-value">{present.length}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><AlertCircle size={24} color="#f59e0b" /></div>
            <div className="stat-info">
              <span className="stat-label">Late</span>
              <div className="stat-value">{late.length}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><XCircle size={24} color="#ef4444" /></div>
            <div className="stat-info">
              <span className="stat-label">Absent</span>
              <div className="stat-value">{absent.length}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><Clock size={24} color="#2563eb" /></div>
            <div className="stat-info">
              <span className="stat-label">On Leave</span>
              <div className="stat-value">{onLeave.length}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon"><TrendingUp size={24} color="#8b5cf6" /></div>
            <div className="stat-info">
              <span className="stat-label">Avg Hours</span>
              <div className="stat-value">{avgHours.toFixed(1)}h</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '2px solid #e5e7eb', paddingBottom: 0 }}>
          <button onClick={() => setActiveTab('overview')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: activeTab === 'overview' ? '#f97316' : '#6b7280', borderBottom: activeTab === 'overview' ? '2px solid #f97316' : '2px solid transparent', marginBottom: -2 }}>
            <PieChart size={16} /> Overview
          </button>
          <button onClick={() => setActiveTab('employees')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500, color: activeTab === 'employees' ? '#f97316' : '#6b7280', borderBottom: activeTab === 'employees' ? '2px solid #f97316' : '2px solid transparent', marginBottom: -2 }}>
            <Users size={16} /> Employee Stats
          </button>
        </div>

        {activeTab === 'overview' && (
          <>
            <div className="dashboard-row">
              <div className="dashboard-card">
                <div className="card-header"><h3><BarChart3 size={18} /> Today's Attendance Summary</h3></div>
                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
                    {summaryCards.filter(s => s.count > 0 || s.label === 'Present').map(s => {
                      const percentage = employees.length > 0 ? ((s.count / employees.length) * 100).toFixed(1) : '0'
                      return (
                        <div key={s.label} style={{ padding: 16, borderRadius: 10, background: s.bg, textAlign: 'center' }}>
                          <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.count}</div>
                          <div style={{ fontSize: 12, color: s.color, fontWeight: 500 }}>{s.label}</div>
                          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{percentage}%</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="dashboard-card">
                <div className="card-header"><h3><MapPin size={18} /> Geofence Status</h3></div>
                <div className="card-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: policy?.enableGeofence ? '#dcfce7' : '#f3f4f6', borderRadius: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>Geofence</span>
                      <span style={{ fontSize: 13, color: policy?.enableGeofence ? '#16a34a' : '#6b7280' }}>
                        {policy?.enableGeofence ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    {policy?.enableGeofence && policy.officeLocation && (
                      <div style={{ fontSize: 13, color: '#6b7280' }}>
                        <div>Office: {policy.officeLocation.name}</div>
                        <div>Radius: {policy.officeLocation.radiusMeters}m</div>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: policy?.enableNetworkGuard ? '#dcfce7' : '#f3f4f6', borderRadius: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>Network Guard</span>
                      <span style={{ fontSize: 13, color: policy?.enableNetworkGuard ? '#16a34a' : '#6b7280' }}>
                        {policy?.enableNetworkGuard ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: policy?.enableAntiSpoofing ? '#dcfce7' : '#f3f4f6', borderRadius: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 500 }}>Anti-Spoofing</span>
                      <span style={{ fontSize: 13, color: policy?.enableAntiSpoofing ? '#16a34a' : '#6b7280' }}>
                        {policy?.enableAntiSpoofing ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="dashboard-card" style={{ marginTop: 24 }}>
              <div className="card-header"><h3><TrendingUp size={18} /> Attendance Trend (Last 7 Days)</h3></div>
              <div className="card-body">
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, padding: '16px 0' }}>
                  {trendData.map((d, i) => {
                    const presentPct = d.total > 0 ? (d.present / d.total) * 100 : 0
                    const latePct = d.total > 0 ? (d.late / d.total) * 100 : 0
                    const absentPct = d.total > 0 ? (d.absent / d.total) * 100 : 0
                    const maxHeight = 120
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{ width: '100%', height: maxHeight, display: 'flex', flexDirection: 'column-reverse', gap: 1 }}>
                          <div style={{ width: '100%', height: `${Math.max(absentPct * 0.8, 2)}%`, background: '#fee2e2', borderRadius: '4px 4px 0 0', transition: 'height 0.3s', minHeight: absentPct > 0 ? 4 : 0 }} title={`Absent: ${d.absent}`} />
                          <div style={{ width: '100%', height: `${Math.max(latePct * 0.8, 2)}%`, background: '#fef3c7', borderRadius: '4px 4px 0 0', transition: 'height 0.3s', minHeight: latePct > 0 ? 4 : 0 }} title={`Late: ${d.late}`} />
                          <div style={{ width: '100%', height: `${Math.max(presentPct * 0.8, 2)}%`, background: '#dcfce7', borderRadius: '4px 4px 0 0', transition: 'height 0.3s', minHeight: presentPct > 0 ? 4 : 0 }} title={`Present: ${d.present}`} />
                        </div>
                        <span style={{ fontSize: 10, color: '#9ca3af', whiteSpace: 'nowrap' }}>{d.label}</span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: 16, justifyContent: 'center', fontSize: 12, color: '#6b7280' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#dcfce7', display: 'inline-block' }} /> Present</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#fef3c7', display: 'inline-block' }} /> Late</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#fee2e2', display: 'inline-block' }} /> Absent</span>
                </div>
              </div>
            </div>

            <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb', marginTop: 24 }}>
              {filtered.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>
                  <User size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                  <p>No attendance records found for {selectedCompanyName || 'this company'} in this date range</p>
                </div>
              ) : (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800 }}>
                      <thead>
                        <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                          <th style={thLeft}>Employee</th>
                          <th style={thStyle}>Department</th>
                          <th style={thStyle}>Date</th>
                          <th style={thStyle}>Check In</th>
                          <th style={thStyle}>Check Out</th>
                          <th style={thStyle}>Status</th>
                          <th style={thStyle}>Hours</th>
                          <th style={thStyle}>Overtime</th>
                          <th style={thStyle}>Shift</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginated.map(r => {
                          const sc = statusStyle[r.status] || statusStyle['Present']
                          const StatusIcon = sc.icon
                          return (
                            <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={tdLeft}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', overflow: 'hidden', flexShrink: 0 }}>
                                    {r.avatar ? <img src={r.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={16} style={{ margin: 8, color: '#9ca3af' }} />}
                                  </div>
                                  <div>
                                    <div style={{ fontWeight: 500, fontSize: 14 }}>{r.name}</div>
                                    <div style={{ fontSize: 12, color: '#9ca3af' }}>{r.employeeId || ''}</div>
                                  </div>
                                </div>
                              </td>
                              <td style={tdStyle}>{r.department || '--'}</td>
                              <td style={tdStyle}>{formatDate(r.date)}</td>
                              <td style={tdStyle}>{formatTime(r.checkIn)}</td>
                              <td style={tdStyle}>{formatTime(r.checkOut)}</td>
                              <td style={tdStyle}>
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                                  background: sc.bg, color: sc.text
                                }}>
                                  <StatusIcon size={12} /> {r.status}
                                </span>
                              </td>
                              <td style={tdStyle}>{r.workHours ? `${r.workHours.toFixed(1)}h` : '--'}</td>
                              <td style={tdStyle}>{r.overtimeHours ? `${r.overtimeHours.toFixed(1)}h` : '--'}</td>
                              <td style={tdStyle}>
                                {r.shiftStart && r.shiftEnd
                                  ? <span style={{ fontSize: 12, color: '#6b7280' }}>{r.shiftStart}-{r.shiftEnd}</span>
                                  : <span style={{ fontSize: 12, color: '#d1d5db' }}>--</span>}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderTop: '1px solid #e5e7eb', fontSize: 13, color: '#6b7280'
                  }}>
                    <span>Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1 }}>
                        <ChevronLeft size={16} />
                      </button>
                      <span>{currentPage} / {totalPages || 1}</span>
                      <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', opacity: currentPage >= totalPages ? 0.5 : 1 }}>
                        <ChevronRight size={16} />
                      </button>
                      <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13 }}>
                        <option value={10}>10</option>
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {activeTab === 'employees' && (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
                <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }} />
                <input type="text" placeholder="Search employees..." value={empStatsSearch}
                  onChange={e => { setEmpStatsSearch(e.target.value); setEmpStatsPage(1) }}
                  style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <span style={{ fontSize: 13, color: '#6b7280' }}>{filteredEmpStats.length} employees</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                    <th style={thLeft}>Employee</th>
                    <th style={thStyle}>Department</th>
                    <th style={thStyle}>Present</th>
                    <th style={thStyle}>Late</th>
                    <th style={thStyle}>Absent</th>
                    <th style={thStyle}>On Leave</th>
                    <th style={thStyle}>Miss Punch</th>
                    <th style={thStyle}>Attendance %</th>
                    <th style={thStyle}>Total Hours</th>
                    <th style={thStyle}>Overtime</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedEmpStats.map(e => (
                    <tr key={e.userId} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={tdLeft}>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>{e.employeeName}</div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>{e.employeeId}</div>
                      </td>
                      <td style={tdStyle}>{e.department || '--'}</td>
                      <td style={{ ...tdStyle, color: '#16a34a', fontWeight: 600 }}>{e.presentDays}</td>
                      <td style={{ ...tdStyle, color: '#f59e0b', fontWeight: 600 }}>{e.lateDays}</td>
                      <td style={{ ...tdStyle, color: '#ef4444', fontWeight: 600 }}>{e.absentDays}</td>
                      <td style={tdStyle}>{e.approvedLeaveDays}</td>
                      <td style={tdStyle}>{e.missPunchDays}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 6, background: '#f3f4f6', borderRadius: 3, maxWidth: 80 }}>
                            <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(e.attendancePercentage, 100)}%`, background: e.attendancePercentage >= 90 ? '#16a34a' : e.attendancePercentage >= 75 ? '#f59e0b' : '#ef4444' }} />
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: e.attendancePercentage >= 90 ? '#16a34a' : e.attendancePercentage >= 75 ? '#f59e0b' : '#ef4444' }}>{e.attendancePercentage}%</span>
                        </div>
                      </td>
                      <td style={tdStyle}>{e.totalWorkingHours.toFixed(1)}h</td>
                      <td style={tdStyle}>{e.totalOvertimeHours.toFixed(1)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredEmpStats.length === 0 && (
              <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>
                <Users size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                <p>No employee data found for this date range</p>
              </div>
            )}
            {filteredEmpStats.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid #e5e7eb', fontSize: 13, color: '#6b7280' }}>
                <span>Showing {(empStatsPage - 1) * pageSize + 1}-{Math.min(empStatsPage * pageSize, filteredEmpStats.length)} of {filteredEmpStats.length}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button disabled={empStatsPage === 1} onClick={() => setEmpStatsPage(p => p - 1)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: empStatsPage === 1 ? 'not-allowed' : 'pointer', opacity: empStatsPage === 1 ? 0.5 : 1 }}>
                    <ChevronLeft size={16} />
                  </button>
                  <span>{empStatsPage} / {totalEmpStatsPages || 1}</span>
                  <button disabled={empStatsPage >= totalEmpStatsPages} onClick={() => setEmpStatsPage(p => p + 1)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: empStatsPage >= totalEmpStatsPages ? 'not-allowed' : 'pointer', opacity: empStatsPage >= totalEmpStatsPages ? 0.5 : 1 }}>
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle',
  fontSize: 12, fontWeight: 600,
  color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap'
}

const thLeft: React.CSSProperties = { ...thStyle, textAlign: 'left' }

const tdStyle: React.CSSProperties = {
  padding: '12px 16px', fontSize: 14, color: '#374151',
  whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'center'
}

const tdLeft: React.CSSProperties = { ...tdStyle, textAlign: 'left' }
