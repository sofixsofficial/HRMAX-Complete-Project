import { useState, useEffect } from 'react'
import { Users, Building2, TrendingUp, DollarSign, Download, Filter, FileText, Loader2, AlertCircle, Eye, RefreshCw } from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useRoleBasedStats } from '../hooks/useRoleBasedData'
import { getAllEmployees, getEmployeeStats, getEmployeesByCompany, getEmployeesByDepartment } from '../services/employeeService'
import { getAllCompanies, getCompanyStats } from '../services/companyService'
import { getAllTickets, getTicketStats } from '../services/ticketService'
import { getAllSalarySlips, getSalaryStats } from '../services/salaryService'
import { getAllAttendance, getAttendanceStats } from '../services/attendanceService'
import { collection, query, where, getDocs } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { logAction } from '../services/auditLogService'
import type { Employee, Company, SupportTicket, SalarySlip, AttendanceRecord } from '../types/user'
import './Reports.css'

const TIME_RANGES = ['This Week', 'This Month', 'This Quarter', 'This Year', 'Last Year']
const REPORT_TYPES = ['All Types', 'Attendance', 'Payroll', 'Performance', 'Analytics', 'HR']

interface Report {
  id: string;
  name: string;
  type: string;
  date: string;
  size: string;
  description?: string;
  generatedBy?: string;
  status: 'Generated' | 'Pending' | 'Processing';
  data?: any;
}

export function Reports() {
  const [timeRange, setTimeRange] = useState('This Month')
  const [departmentFilter, setDepartmentFilter] = useState('All Departments')
  const [reportTypeFilter, setReportTypeFilter] = useState('All Types')
  const [cardFilter, setCardFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)

  const handleCardFilter = (filterValue: string) => {
    setCardFilter(prev => {
      const next = prev === filterValue ? 'All' : filterValue
      if (next === 'employees') setReportTypeFilter('All Types')
      else if (next === 'companies') setReportTypeFilter('Analytics')
      else if (next === 'attendance') setReportTypeFilter('Attendance')
      else if (next === 'payroll') setReportTypeFilter('Payroll')
      return next
    })
  }
  
  // Data states
  const [employees, setEmployees] = useState<Employee[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [salarySlips, setSalarySlips] = useState<SalarySlip[]>([])
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  
  // Stats states
  const [employeeStats, setEmployeeStats] = useState({ total: 0, active: 0, inactive: 0, onLeave: 0 })
  const [companyStats, setCompanyStats] = useState({ total: 0, active: 0, totalEmployees: 0 })
  const [ticketStats, setTicketStats] = useState({ total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 })
  const [salaryStats, setSalaryStats] = useState({ total: 0, paid: 0, pending: 0, processing: 0, totalAmount: 0 })
  const [attendanceStats, setAttendanceStats] = useState({ total: 0, present: 0, absent: 0, late: 0, onLeave: 0 })
  
  // Modal states
  const [isViewModalOpen, setIsViewModalOpen] = useState(false)
  const [selectedReport, setSelectedReport] = useState<Report | null>(null)
  
  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, availableCompanies, canAccessAllCompanies, setSelectedCompanyId } = usePermissionScope('reports')
  const { canViewAllStats } = useRoleBasedStats()
  const companyId = effectiveCompanyId || user?.companyId || ''
  const companyName = availableCompanies.find(c => c.id === companyId)?.name || ''

  useEffect(() => {
    fetchData()
  }, [companyId])

  const isTeamLeader = user?.role === 'team-leader'

  const safeFetch = async <T,>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      console.error(`[Reports] Failed to fetch ${label}:`, err)
      return fallback
    }
  }

  const fetchData = async (isRetry = false) => {
    if (isRetry) setRetrying(true)
    else setLoading(true)
    setError(null)

    const [empData, compData, compStats, tixData, salaryData, attData, empStats, tixStats, salStats, attStats] = await Promise.all([
      safeFetch(async () => {
        if (isTeamLeader && user?.departmentId) return await getEmployeesByDepartment(user.departmentId)
        if (companyId && !canViewAllStats) return await getEmployeesByCompany(companyId)
        return await getAllEmployees()
      }, [], 'employees'),
      safeFetch(async () => canViewAllStats ? await getAllCompanies() : [], [], 'companies'),
      safeFetch(async () => canViewAllStats ? await getCompanyStats() : {
        total: 0, active: 0, totalEmployees: 0
      }, { total: 0, active: 0, totalEmployees: 0 }, 'company stats'),
      safeFetch(async () => {
        if (companyId) {
          const snap = await getDocs(query(collection(db, 'supportTickets'), where('companyId', '==', companyId)))
          return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        }
        return await getAllTickets()
      }, [], 'tickets'),
      safeFetch(async () => {
        if (companyId) {
          const snap = await getDocs(query(collection(db, 'salarySlips'), where('companyId', '==', companyId)))
          return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        }
        return await getAllSalarySlips()
      }, [], 'salary slips'),
      safeFetch(async () => {
        if (companyId) {
          const snap = await getDocs(query(collection(db, 'attendance'), where('companyId', '==', companyId)))
          return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        }
        return await getAllAttendance()
      }, [], 'attendance'),
      safeFetch(async () => await getEmployeeStats(companyId || undefined),
        { total: 0, active: 0, inactive: 0, onLeave: 0 }, 'employee stats'),
      safeFetch(async () => await getTicketStats(companyId || undefined),
        { total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 }, 'ticket stats'),
      safeFetch(async () => await getSalaryStats(companyId || undefined),
        { total: 0, paid: 0, pending: 0, processing: 0, emailed: 0, totalAmount: 0 }, 'salary stats'),
      safeFetch(async () => await getAttendanceStats(companyId || undefined),
        { total: 0, approved: 0, present: 0, late: 0, onLeave: 0, missPunch: 0, absent: 0 }, 'attendance stats'),
    ])

    setEmployees(empData)
    setCompanies(compData)
    setCompanyStats(compStats)
    // Snapshot reads above are untyped (d.data() is DocumentData) — the runtime
    // documents are full records; narrow once here where the data enters state.
    setTickets(tixData as SupportTicket[])
    setSalarySlips(salaryData as SalarySlip[])
    setAttendance(attData as AttendanceRecord[])
    setEmployeeStats(empStats)
    setTicketStats(tixStats)
    setSalaryStats(salStats)
    setAttendanceStats(attStats)

    // Check if core data (employees) failed
    if (empData.length === 0 && (!!companyId || !canViewAllStats)) {
      setError('Unable to load employee data. Some sections may be empty.')
    }
    setLoading(false)
    setRetrying(false)
  }

  // Generate reports from actual data
  const generateReports = (): Report[] => {
    const reports: Report[] = []
    const baseDate = new Date()
    
    if (employees.length > 0) {
      reports.push({
        id: '1',
        name: 'Employee Attendance Summary',
        type: 'Attendance',
        date: new Date(baseDate.getTime() - 86400000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
        size: `${(attendance.length * 0.1).toFixed(1)} KB`,
        description: `Monthly attendance report showing check-in/out times, work hours, and attendance percentage for ${employees.length} employees.`,
        generatedBy: 'System',
        status: 'Generated',
        data: attendanceStats
      })
    }
    
    if (salarySlips.length > 0) {
      reports.push({
        id: '2',
        name: 'Payroll Summary',
        type: 'Payroll',
        date: new Date(baseDate.getTime() - 5 * 86400000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
        size: `${(salarySlips.length * 0.5).toFixed(1)} KB`,
        description: `Payroll summary including ${salaryStats.paid} paid, ${salaryStats.pending} pending slips. Total amount: $${salaryStats.totalAmount.toLocaleString()}.`,
        generatedBy: 'HR Manager',
        status: 'Generated',
        data: salaryStats
      })
    }
    
    if (employees.length > 0) {
      reports.push({
        id: '3',
        name: 'Employee Performance Report',
        type: 'Performance',
        date: new Date(baseDate.getTime() - 10 * 86400000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
        size: `${(employees.length * 0.3).toFixed(1)} KB`,
        description: `Performance evaluation report for ${employeeStats.active} active employees including attendance and task completion metrics.`,
        generatedBy: 'Department Manager',
        status: 'Generated',
        data: employeeStats
      })
    }
    
    if (companies.length > 0) {
      reports.push({
        id: '4',
        name: 'Company Analysis Report',
        type: 'Analytics',
        date: new Date(baseDate.getTime() - 14 * 86400000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
        size: `${(companies.length * 0.8).toFixed(1)} KB`,
        description: `Analysis of ${companyStats.total} companies with ${companyStats.totalEmployees} total employees across different statuses.`,
        generatedBy: 'Analytics Team',
        status: 'Generated',
        data: companyStats
      })
    }

    // Attendance vs Mandatory compliance report
    if (employees.length > 0 && companies.some(c => c.mandatoryAttendanceDays)) {
      const companiesWithPolicy = companies.filter(c => c.mandatoryAttendanceDays)
      reports.push({
        id: '7',
        name: 'Attendance Compliance Report',
        type: 'Attendance',
        date: new Date(baseDate.getTime() - 1 * 86400000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
        size: '8 KB',
        description: `Compares actual attendance against mandatory thresholds for ${companiesWithPolicy.length} company(ies) with attendance policies. Identifies employees below the ${Math.min(...companiesWithPolicy.map(c => c.mandatoryAttendanceDays || 22))}-day minimum.`,
        generatedBy: 'System',
        status: 'Generated',
        data: { ...attendanceStats, complianceThreshold: companiesWithPolicy.reduce((min: number, c) => Math.min(min, c.mandatoryAttendanceDays || 22), 99) }
      })
    }

    // Total Monthly Payroll Cost report
    if (employees.length > 0) {
      const totalPayroll = employees.reduce((sum, e) => sum + (e.monthlyGrossSalary || 0), 0)
      reports.push({
        id: '8',
        name: 'Monthly Payroll Cost Report',
        type: 'Payroll',
        date: new Date(baseDate.getTime() - 1 * 86400000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
        size: '6 KB',
        description: `Total monthly payroll cost across all employees: $${totalPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}. Based on ${employees.filter(e => e.monthlyGrossSalary).length} employees with salary data out of ${employees.length} total.`,
        generatedBy: 'System',
        status: 'Generated',
        data: { totalPayroll, employeesWithSalary: employees.filter(e => e.monthlyGrossSalary).length, totalEmployees: employees.length }
      })
    }
    
    if (tickets.length > 0) {
      reports.push({
        id: '5',
        name: 'Support Tickets Report',
        type: 'HR',
        date: new Date(baseDate.getTime() - 20 * 86400000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
        size: `${(tickets.length * 0.2).toFixed(1)} KB`,
        description: `Overview of ${ticketStats.total} support tickets: ${ticketStats.open} open, ${ticketStats.resolved} resolved.`,
        generatedBy: 'Support Team',
        status: 'Generated',
        data: ticketStats
      })
    }
    
    reports.push({
      id: '6',
      name: 'Leave Management Report',
      type: 'HR',
      date: new Date(baseDate.getTime() - 25 * 86400000).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
      size: '12 KB',
      description: `Summary of leave requests and employee availability. ${employeeStats.onLeave} employees currently on leave.`,
      generatedBy: 'System',
      status: 'Generated',
      data: employeeStats
    })
    
    return reports
  }
  
  const [reports, setReports] = useState<Report[]>([])

  useEffect(() => {
    if (!loading && employees.length >= 0) {
      setReports(generateReports())
    }
  }, [employees, companies, tickets, salarySlips, attendance, loading])

  // Calculate department distribution
  const departmentData = Array.from(new Set(employees.map(e => e.department).filter(Boolean)))
    .map((dept, idx) => {
      const count = employees.filter(e => e.department === dept).length
      return {
        name: dept,
        count,
        percentage: Math.round((count / (employees.length || 1)) * 100) || 0,
        color: ['#f97316', '#10b981', '#f59e0b', '#22c55e', '#ec4899', '#6b7280'][idx % 6]
      }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  // Compute monthly attendance trend from real records
  const chartData = (() => {
    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
    const byMonth: Record<string, { employees: Set<string>; present: number; total: number }> = {}

    for (const rec of attendance) {
      const d = rec.date instanceof Date ? rec.date : new Date(rec.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!byMonth[key]) byMonth[key] = { employees: new Set(), present: 0, total: 0 }
      byMonth[key].employees.add(rec.userId)
      byMonth[key].total++
      if (rec.status === 'Present') byMonth[key].present++
    }

    const now = new Date()
    const trend = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const m = byMonth[key]
      trend.push({
        month: monthLabels[d.getMonth()],
        employees: m ? m.employees.size : 0,
        attendance: m ? Math.round((m.present / m.total) * 100) : 0
      })
    }
    return trend
  })()

  // Calculate payroll amount
  const totalPayroll = salaryStats.totalAmount

  // Compute previous-month attendance rate for change indicator
  const prevMonthRate = (() => {
    const now = new Date()
    const prevKey = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`
    const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const byMonth: Record<string, { present: number; total: number }> = {}
    for (const rec of attendance) {
      const d = rec.date instanceof Date ? rec.date : new Date(rec.date)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!byMonth[key]) byMonth[key] = { present: 0, total: 0 }
      byMonth[key].total++
      if (rec.status === 'Present') byMonth[key].present++
    }
    const cur = byMonth[curKey]
    const prev = byMonth[prevKey]
    if (cur && prev && prev.total > 0 && cur.total > 0) {
      const curRate = cur.present / cur.total
      const prevRate = prev.present / prev.total
      const diff = ((curRate - prevRate) * 100).toFixed(1)
      return diff.startsWith('-') ? `${diff}%` : `+${diff}%`
    }
    return '—'
  })()

  const statsCards = [
    { icon: Users, label: 'Total Employees', value: String(employeeStats.total), change: `+${employees.filter(e => {
      const jd = (e.joinDate as any)?.toDate ? (e.joinDate as any).toDate() : new Date(e.joinDate || Date.now())
      const monthAgo = new Date()
      monthAgo.setMonth(monthAgo.getMonth() - 1)
      return jd > monthAgo
    }).length}`, changeColor: '#10b981', color: '#f97316', bgColor: '#fff7ed', filterValue: 'employees' },
    ...(!isTeamLeader ? [{
      icon: Building2, label: 'Active Companies', value: String(companyStats.active), change: `+${companies.filter(c => {
        const cd = (c.createdOn as any)?.toDate ? (c.createdOn as any).toDate() : new Date(c.createdOn || Date.now())
        const monthAgo = new Date()
        monthAgo.setMonth(monthAgo.getMonth() - 1)
        return cd > monthAgo
      }).length}`, changeColor: '#10b981', color: '#10b981', bgColor: '#ecfdf5', filterValue: 'companies'
    }] : [{
      icon: Building2, label: 'My Team Size', value: String(employees.length), change: `${employees.filter(e => e.status === 'Active').length} Active`, changeColor: '#10b981', color: '#8b5cf6', bgColor: '#f5f3ff', filterValue: 'employees'
    }]),
    { icon: TrendingUp, label: 'Avg Attendance Rate', value: `${attendanceStats.total > 0 ? Math.round((attendanceStats.present / attendanceStats.total) * 100) : 0}%`, change: prevMonthRate, changeColor: '#10b981', color: '#f59e0b', bgColor: '#fffbeb', filterValue: 'attendance' },
    { icon: DollarSign, label: 'Total Payroll', value: `$${(totalPayroll / 1000000).toFixed(1)}M`, change: '—', changeColor: '#10b981', color: '#22c55e', bgColor: '#f0fdf4', filterValue: 'payroll' }
  ]

  const departments = Array.from(new Set(employees.map(e => e.department))).filter(Boolean)

  const filteredReports = reports.filter(report => {
    if (reportTypeFilter !== 'All Types' && report.type !== reportTypeFilter) return false
    if (departmentFilter !== 'All Departments' && report.data?.department !== departmentFilter) return false
    if (cardFilter === 'employees' && report.type !== 'Attendance' && report.type !== 'Performance') return false
    if (cardFilter === 'companies' && report.type !== 'Analytics') return false
    if (cardFilter === 'attendance' && report.type !== 'Attendance') return false
    if (cardFilter === 'payroll' && report.type !== 'Payroll') return false
    return true
  })

  const handleExportData = async () => {
    // Export employee data
    const csvContent = [
      ['Report Type', 'Employee Data Export'].join(','),
      ['Generated On', new Date().toLocaleDateString()].join(','),
      [''],
      ['Metric', 'Value'].join(','),
      ['Total Employees', employeeStats.total].join(','),
      ['Active Employees', employeeStats.active].join(','),
      ['On Leave', employeeStats.onLeave].join(','),
      ['Inactive', employeeStats.inactive].join(','),
      [''],
      ['Department Distribution'].join(','),
      ['Department', 'Count', 'Percentage'].join(','),
      ...departmentData.map(d => [d.name, d.count, `${d.percentage}%`].join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hr-report-${new Date().toISOString().split('T')[0]}.csv`
    a.click()

    // Log action
    if (user) {
      await logAction(user.id, user.name, user.role, 'Export', 'Report', 'all', 'Exported HR report data', companyId || undefined)
    }
  }

  const handleGenerateReport = async (reportType: string) => {
    setGeneratingReport(true)
    try {
      if (user) {
        await logAction(user.id, user.name, user.role, 'Generate', 'Report', reportType, `Generated ${reportType} report`, companyId || undefined)
      }
    } catch (err) {
      console.error('Error generating report:', err)
    } finally {
      setGeneratingReport(false)
    }
  }

  const handleDownloadReport = (report: Report) => {
    // Create report content based on type
    let content = ''
    
    if (report.type === 'Attendance') {
      content = [
        ['Attendance Report', report.name].join(','),
        ['Generated', report.date].join(','),
        [''],
        ['Metric', 'Value'].join(','),
        ['Total Records', attendanceStats.total].join(','),
        ['Present', attendanceStats.present].join(','),
        ['Absent', attendanceStats.absent].join(','),
        ['Late', attendanceStats.late].join(','),
        ['On Leave', attendanceStats.onLeave].join(',')
      ].join('\n')
      if (report.data?.complianceThreshold) {
        content += '\n\n' + [
          ['Compliance Analysis'].join(','),
          ['Mandatory Threshold', `${report.data.complianceThreshold} days`].join(','),
          ['Compliant Employees', `${attendanceStats.total > 0 ? Math.round((attendanceStats.present / attendanceStats.total) * 100) : 0}%`].join(','),
        ].join('\n')
      }
    } else if (report.type === 'Payroll') {
      content = [
        ['Payroll Report', report.name].join(','),
        ['Generated', report.date].join(','),
        [''],
        ['Metric', 'Value'].join(','),
        ['Total Slips', salaryStats.total].join(','),
        ['Paid', salaryStats.paid].join(','),
        ['Pending', salaryStats.pending].join(','),
        ['Processing', salaryStats.processing].join(','),
        ['Total Amount', `$${salaryStats.totalAmount.toLocaleString()}`].join(',')
      ].join('\n')
      if (report.data?.totalPayroll !== undefined) {
        content += '\n\n' + [
          ['Monthly Payroll Cost Analysis'].join(','),
          ['Total Monthly Payroll', `$${report.data.totalPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}`].join(','),
          ['Employees with Salary Data', report.data.employeesWithSalary].join(','),
          ['Total Employees', report.data.totalEmployees].join(','),
        ].join('\n')
      }
    } else {
      content = [
        [report.type, 'Report'].join(' '),
        ['Name', report.name].join(','),
        ['Generated', report.date].join(','),
        ['Description', report.description].join(',')
      ].join('\n')
    }
    
    const blob = new Blob([content], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${report.name.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const openViewModal = (report: Report) => {
    setSelectedReport(report)
    setIsViewModalOpen(true)
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Reports & Analytics" breadcrumbs={['Dashboard', 'Reports & Analytics']} />
        <div className="page-content">
          <div className="reports-skeleton">
            <div className="skeleton-stats">
              {[1,2,3,4].map(i => (
                <div key={i} className="skeleton-stat">
                  <div className="skeleton-stat-inner">
                    <div className="skeleton-icon" />
                    <div className="skeleton-stat-text">
                      <div className="skeleton-label" />
                      <div className="skeleton-value" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="skeleton-filters">
              <div className="skeleton-filter" />
              <div className="skeleton-filter" />
              <div className="skeleton-filter" />
              <div className="skeleton-filter-btn" />
              <div className="skeleton-filter-btn" />
            </div>
            <div className="skeleton-charts">
              <div className="skeleton-chart-card">
                <div className="skeleton-chart-header" />
                <div className="skeleton-chart-body" />
              </div>
              <div className="skeleton-chart-card">
                <div className="skeleton-chart-header" />
                <div className="skeleton-chart-body" />
              </div>
            </div>
            <div className="skeleton-reports-section">
              <div className="skeleton-reports-header" />
              <div className="skeleton-reports-grid">
                {[1,2,3,4].map(i => <div key={i} className="skeleton-report-card" />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error && employees.length === 0 && companies.length === 0) {
    return (
      <div className="page-container">
        <Header title="Reports & Analytics" breadcrumbs={['Dashboard', 'Reports & Analytics']} />
        <div className="page-content">
          <div className="reports-error-container">
            <div className="reports-error-icon">
              <AlertCircle size={36} />
            </div>
            <h3 className="reports-error-title">Unable to Load Report Data{companyName ? ` for ${companyName}` : ''}</h3>
            <p className="reports-error-message">{error}</p>
            <div className="reports-error-actions">
              <button className="btn-retry" onClick={() => fetchData(true)} disabled={retrying}>
                {retrying ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                {retrying ? 'Retrying...' : 'Retry'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Reports & Analytics" breadcrumbs={['Dashboard', 'Reports & Analytics']} />
      
      <div className="page-content">
        {error && (
          <div className="reports-warning-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button className="btn-retry-sm" onClick={() => fetchData(true)} disabled={retrying}>
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
          </div>
        )}
        {/* Stats Cards */}
        <div className="stats-row reports-stats">
          {statsCards.map((stat, idx) => (
            <div key={idx} className={`stat-card-reports${cardFilter === stat.filterValue ? ' stat-active' : ''}`} onClick={() => handleCardFilter(stat.filterValue)} style={{ cursor: 'pointer', transition: 'all 0.2s', border: cardFilter === stat.filterValue ? `2px solid ${stat.color}` : '2px solid transparent', boxShadow: cardFilter === stat.filterValue ? `0 4px 16px ${stat.color}20` : '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div className="stat-card-content">
                <div className="stat-icon-wrapper" style={{ background: stat.bgColor, color: stat.color }}>
                  <stat.icon size={24} />
                </div>
                <div className="stat-details">
                  <span className="stat-label">{stat.label}</span>
                  <div className="stat-value-row">
                    <span className="stat-value">{stat.value}</span>
                    <span className="stat-change" style={{ color: stat.changeColor }}>{stat.change}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="reports-filters-section">
          <div className="filters-row reports-filters">
            <div className="emp-filter-group">
              <select className="filter-select" value={companyId} onChange={(e) => setSelectedCompanyId(e.target.value || '')}>
                {canAccessAllCompanies && <option value="">All Companies</option>}
                {availableCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <select className="filter-select" value={timeRange} onChange={(e) => setTimeRange(e.target.value)}>
              {TIME_RANGES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="filter-select" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
              <option value="All Departments">All Departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="filter-select" value={reportTypeFilter} onChange={(e) => { setReportTypeFilter(e.target.value); setCardFilter('All') }}>
              {REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className="btn-filter"><Filter size={16} />More Filters</button>
            {hasPermission('reports.export') && (
              <button className="btn-primary" onClick={handleExportData}><Download size={18} />Export Data</button>
            )}
          </div>
        </div>

        {/* Charts Section */}
        <div className="charts-section">
          {/* Main Chart */}
          <div className="chart-card main-chart">
            <div className="chart-header">
              <h3>Employee Growth & Attendance</h3>
              <div className="chart-legend">
                <span className="legend-item"><span className="legend-dot blue"></span>Employees</span>
                <span className="legend-item"><span className="legend-dot green"></span>Attendance %</span>
              </div>
            </div>
            <div className="chart-container">
              <div className="bar-chart">
                {chartData.map((data, idx) => (
                  <div key={idx} className="bar-group">
                    <div className="bar-wrapper">
                      <div className="bar blue" style={{ height: `${(data.employees / (employees.length || 1)) * 100}%` }}></div>
                      <div className="bar green" style={{ height: `${data.attendance}%` }}></div>
                    </div>
                    <span className="bar-label">{data.month}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Department Distribution */}
          <div className="chart-card pie-chart-card">
            <div className="chart-header">
              <h3>Department Distribution</h3>
            </div>
            <div className="pie-chart-container">
              <div className="pie-chart">
                <svg viewBox="0 0 100 100" className="pie-svg">
                  {departmentData.map((dept, idx) => {
                    const circumference = 2 * Math.PI * 40
                    const offset = departmentData.slice(0, idx).reduce((sum, d) => sum + (d.percentage / 100) * circumference, 0)
                    const dashArray = `${(dept.percentage / 100) * circumference} ${circumference}`
                    return (
                      <circle 
                        key={dept.name}
                        cx="50" 
                        cy="50" 
                        r="40" 
                        fill="none" 
                        stroke={dept.color} 
                        strokeWidth="20" 
                        strokeDasharray={dashArray}
                        strokeDashoffset={-offset}
                        transform="rotate(-90 50 50)"
                      />
                    )
                  })}
                </svg>
                <div className="pie-center">
                  <span className="pie-value">{employees.length}</span>
                  <span className="pie-label">Total</span>
                </div>
              </div>
              <div className="pie-legend">
                {departmentData.map((dept) => (
                  <div key={dept.name} className="pie-legend-item">
                    <span className="legend-color" style={{ background: dept.color }}></span>
                    <span className="legend-name">{dept.name}</span>
                    <span className="legend-value">{dept.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Recent Reports */}
        <div className="reports-list-section">
          <div className="section-header-reports">
            <div className="section-title-group"><h3>Available Reports</h3><p>Generate and download reports based on your data. ({filteredReports.length} reports)</p></div>
          </div>
          <div className="reports-grid">
            {filteredReports.map((report) => (
              <div key={report.id} className="report-card">
                <div className="report-icon">
                  <FileText size={24} />
                </div>
                <div className="report-details">
                  <h4>{report.name}</h4>
                  <div className="report-meta">
                    <span className="report-type">{report.type}</span>
                    <span className="report-date">{report.date}</span>
                    <span className="report-size">{report.size}</span>
                  </div>
                </div>
                <div className="report-actions">
                  {hasPermission('reports.view') && (
                    <button className="action-btn view" onClick={() => openViewModal(report)}><Eye size={18} /></button>
                  )}
                  {hasPermission('reports.download') && (
                    <button className="report-download" onClick={() => handleDownloadReport(report)}><Download size={18} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* View Report Modal */}
      <Modal isOpen={isViewModalOpen} onClose={() => setIsViewModalOpen(false)} title="Report Details" size="medium">
        {selectedReport && (
          <div className="report-details-view">
            <div className="report-header-modal">
              <div className="report-icon-lg">
                <FileText size={32} />
              </div>
              <div className="report-header-info">
                <h3>{selectedReport.name}</h3>
                <span className={`report-status-badge ${selectedReport.status.toLowerCase()}`}>{selectedReport.status}</span>
              </div>
            </div>
            <div className="report-info-grid">
              <div className="detail-row"><span className="detail-label">Report Type:</span><span className="detail-value">{selectedReport.type}</span></div>
              <div className="detail-row"><span className="detail-label">Generated On:</span><span className="detail-value">{selectedReport.date}</span></div>
              <div className="detail-row"><span className="detail-label">File Size:</span><span className="detail-value">{selectedReport.size}</span></div>
              <div className="detail-row"><span className="detail-label">Generated By:</span><span className="detail-value">{selectedReport.generatedBy || 'System'}</span></div>
              <div className="detail-row full-width">
                <span className="detail-label">Description:</span>
                <span className="detail-value">{selectedReport.description}</span>
              </div>
            </div>
            <div className="report-actions-modal">
              {hasPermission('reports.download') && (
                <button 
                  className="btn-primary" 
                  onClick={() => handleDownloadReport(selectedReport)}
                  disabled={generatingReport}
                >
                  <Download size={16} /> Download Report
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
