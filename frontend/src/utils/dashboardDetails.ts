import type { DashboardRecords } from '../hooks/useDashboardStats'

export interface CardDetailConfig {
  title: string
  columns: { key: string; label: string }[]
  rows: Record<string, any>[]
}

interface DetailCtx {
  records: DashboardRecords
  counts: {
    totalEmployees?: number
    activeEmployees?: number
    inactiveEmployees?: number
    presentToday?: number
    absentToday?: number
    lateToday?: number
    onLeaveToday?: number
    missPunchToday?: number
    approvedAttendanceToday?: number
    pendingLeaves?: number
    totalLeaveRequests?: number
    approvedLeaves?: number
    rejectedLeaves?: number
    pendingTasks?: number
  }
  executives?: any[]
  teamLeaders?: any[]
}

const fmtDate = (v: any): string => {
  if (!v) return '—'
  const d = v?.toDate?.() || (v instanceof Date ? v : new Date(v))
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const fmtTime = (v: any): string => {
  if (!v) return '—'
  if (typeof v === 'string') return v
  const d = v?.toDate?.() || v
  return d instanceof Date && !isNaN(d.getTime())
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : String(v)
}

const EMPLOYEE_COLUMNS = [
  { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
  { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
  { key: 'empId', label: 'Employee ID' },
  { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
  { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'joining', label: 'Joining Date' },
  { key: 'status', label: 'Status' },
]

const ATTENDANCE_COLUMNS = [
  { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
  { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
  { key: 'empId', label: 'Employee ID' },
  { key: 'department', label: 'Department' }, { key: 'checkIn', label: 'Check-In' }, { key: 'checkOut', label: 'Check-Out' },
  { key: 'workMode', label: 'Work Mode' }, { key: 'date', label: 'Date' },
]

const LEAVE_COLUMNS_FULL = [
  { key: 'name', label: 'Employee' }, { key: 'company', label: 'Company' },
  { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
  { key: 'leaveType', label: 'Leave Type' },
  { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'days', label: 'Days' },
  { key: 'appliedOn', label: 'Applied On' }, { key: 'reason', label: 'Reason' }, { key: 'status', label: 'Status' },
]

const TASK_COLUMNS = [
  { key: 'title', label: 'Task' }, { key: 'assignedTo', label: 'Assigned To' }, { key: 'company', label: 'Company' },
  { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
  { key: 'priority', label: 'Priority' }, { key: 'dueDate', label: 'Due Date' }, { key: 'createdOn', label: 'Created On' },
]

const COMPANY_COLUMNS = [
  { key: 'name', label: 'Company Name' }, { key: 'code', label: 'Code' }, { key: 'domain', label: 'Domain' },
  { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
  { key: 'adminName', label: 'Admin' }, { key: 'employees', label: 'Employees' },
  { key: 'phone', label: 'Phone' }, { key: 'status', label: 'Status' },
]

const EXECUTIVE_COLUMNS = [
  { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
  { key: 'designation', label: 'Designation' }, { key: 'companies', label: 'Companies' },
  { key: 'teamLeaders', label: 'Team Leaders' },
]

export function getCardDetailConfig(key: string, ctx: DetailCtx): CardDetailConfig | null {
  const { records, counts } = ctx

  const companyMap = new Map(records.companies.map((c: any) => [c.id, c.name || '—']))
  const companyNameOf = (cid: any) => (cid && companyMap.get(cid)) || '—'
  const employeeByUserId = new Map<string, any>(
    records.employees.map((e: any): [string, any] => [e.userId || e.id, e]).filter(([uid]) => !!uid)
  )
  const employeeNameOf = (userId?: string) =>
    records.employees.find((e: any) => e.userId === userId)?.name || ''

  // Ownership columns: which Executive / Team Leader a record falls under
  const execOfCompany = (cid: any): string => {
    if (!cid) return '—'
    const c = records.companies.find((x: any) => x.id === cid)
    if (c?.assignedExecutiveName) return c.assignedExecutiveName
    const ex = (ctx.executives || []).find((x: any) => (x.assignedCompanyIds || []).includes(cid))
    return ex?.name || '—'
  }
  const tlsOfCompany = (cid: any): string => {
    if (!cid) return '—'
    const names = (ctx.teamLeaders || [])
      .filter((tl: any) => tl.companyId === cid || (tl.assignedCompanyIds || []).includes(cid))
      .map((tl: any) => tl.name)
      .filter(Boolean)
    return names.join(', ') || '—'
  }
  const tlNameById = new Map((ctx.teamLeaders || []).map((t: any) => [t.id, t.name]))

  const employeeRow = (e: any) => ({
    id: e.id,
    name: e.name || [e.firstName, e.lastName].filter(Boolean).join(' ') || '—',
    company: companyNameOf(e.companyId),
    empId: e.employeeId || e.empCode || '—',
    department: e.department || e.departmentName || '—',
    designation: e.designation || e.jobTitle || '—',
    email: e.email || '—',
    phone: e.phone || '—',
    joining: fmtDate(e.joinDate || e.joiningDate),
    status: e.status || '—',
    executive: execOfCompany(e.companyId),
    teamLeader: tlsOfCompany(e.companyId),
  })

  const attendanceRow = (a: any) => {
    const empRec = employeeByUserId.get(a.userId)
    return {
      id: a.id,
      name: a.name || employeeNameOf(a.userId) || '—',
      company: companyNameOf(a.companyId),
      empId: a.empCode || empRec?.employeeId || empRec?.empCode || '—',
      department: a.department || empRec?.department || '—',
      checkIn: fmtTime(a.checkIn),
      checkOut: fmtTime(a.checkOut),
      workMode: a.workMode || a.mode || '—',
      date: fmtDate(a.date),
      executive: execOfCompany(a.companyId),
      teamLeader: tlsOfCompany(a.companyId),
    }
  }

  const attendanceRowsFrom = (list: any[]) => list.filter(Boolean).map(attendanceRow)

  const attendanceRows = (statuses: string[]) =>
    attendanceRowsFrom(records.attendanceToday.filter((a: any) => statuses.includes(a.status)))

  const leaveRows = (status?: string) =>
    records.leaves
      .filter((l: any) => !status || l.status === status)
      .map((l: any) => {
        const fromD = (l.startDate || l.fromDate)
        const toD = (l.endDate || l.toDate)
        let days: number | string = '—'
        if (fromD && toD) {
          const f = fromD?.toDate?.() || new Date(fromD)
          const t = toD?.toDate?.() || new Date(toD)
          if (!isNaN(f.getTime()) && !isNaN(t.getTime())) days = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1)
        }
        return {
          id: l.id,
          name: l.employeeName || l.userName || employeeNameOf(l.userId) || '—',
          company: companyNameOf(l.companyId),
          leaveType: l.leaveType || '—',
          from: fmtDate(fromD),
          to: fmtDate(toD),
          days,
          appliedOn: fmtDate(l.createdAt || l.appliedOn || l.appliedAt),
          reason: l.reason || l.leaveReason || '—',
          status: l.status || '—',
          executive: execOfCompany(l.companyId),
          teamLeader: tlsOfCompany(l.companyId),
        }
      })

  switch (key) {
    case 'employees':
      return { title: `Employee Details (${counts.totalEmployees ?? records.employees.length})`, columns: EMPLOYEE_COLUMNS, rows: records.employees.map(employeeRow) }

    case 'active-employees':
      return { title: `Active Employees (${counts.activeEmployees ?? 0})`, columns: EMPLOYEE_COLUMNS, rows: records.employees.filter((e: any) => e.status === 'Active').map(employeeRow) }

    case 'inactive-employees':
      return { title: `Inactive Employees (${counts.inactiveEmployees ?? 0})`, columns: EMPLOYEE_COLUMNS, rows: records.employees.filter((e: any) => e.status === 'Inactive').map(employeeRow) }

    case 'total-companies': {
      const rows = records.companies.map((c: any) => ({
        id: c.id,
        name: c.name || '—',
        code: c.code || '—',
        domain: c.domain || '—',
        adminName: c.adminName || c.adminEmail || '—',
        employees: records.employees.filter((e: any) => e.companyId === c.id).length,
        phone: c.phone || '—',
        status: c.status || '—',
        executive: execOfCompany(c.id),
        teamLeader: tlsOfCompany(c.id),
      }))
      return { title: `Company Details (${rows.length})`, columns: COMPANY_COLUMNS, rows }
    }

    case 'present':
      return { title: `Present Employees (${counts.presentToday ?? 0})`, columns: ATTENDANCE_COLUMNS, rows: attendanceRows(['Present']) }

    case 'absent':
      return { title: `Absent Employees (${counts.absentToday ?? 0})`, columns: ATTENDANCE_COLUMNS, rows: attendanceRows(['Absent']) }

    case 'late':
      return { title: `Late Employees (${counts.lateToday ?? 0})`, columns: ATTENDANCE_COLUMNS, rows: attendanceRows(['Late']) }

    case 'on-leave':
      return { title: `Employees On Leave (${counts.onLeaveToday ?? 0})`, columns: EMPLOYEE_COLUMNS, rows: records.employees.filter((e: any) => e.status === 'On Leave').map(employeeRow) }

    case 'miss-punch':
      return {
        title: `Missed Punch (${counts.missPunchToday ?? 0})`,
        columns: ATTENDANCE_COLUMNS,
        rows: records.missPunchRecords
          ? attendanceRowsFrom(records.missPunchRecords)
          : attendanceRows(['Miss Punch', 'MissPunch', 'miss-punch', 'miss_punch']),
      }

    case 'approved-attendance':
      return { title: `Approved Attendance (${counts.approvedAttendanceToday ?? 0})`, columns: ATTENDANCE_COLUMNS, rows: attendanceRows(['Approved']) }

    case 'leaves-pending':
      return { title: `Pending Leave Requests (${counts.pendingLeaves ?? 0})`, columns: LEAVE_COLUMNS_FULL, rows: leaveRows('Pending') }

    case 'leaves-total':
      return { title: `All Leave Requests (${counts.totalLeaveRequests ?? 0})`, columns: LEAVE_COLUMNS_FULL, rows: leaveRows() }

    case 'leaves-approved':
      return { title: `Approved Leaves (${counts.approvedLeaves ?? 0})`, columns: LEAVE_COLUMNS_FULL, rows: leaveRows('Approved') }

    case 'leaves-rejected':
      return { title: `Rejected Leaves (${counts.rejectedLeaves ?? 0})`, columns: LEAVE_COLUMNS_FULL, rows: leaveRows('Rejected') }

    case 'tasks-pending': {
      const rows = records.tasks
        .filter((t: any) => t.status === 'Pending' || t.status === 'todo')
        .map((t: any) => ({
          id: t.id,
          title: t.title || '—',
          assignedTo: t.assignedTo || '—',
          company: companyNameOf(t.companyId),
          dueDate: fmtDate(t.dueDate),
          priority: t.priority || '—',
          createdOn: fmtDate(t.createdOn || t.createdAt),
          executive: execOfCompany(t.companyId),
          teamLeader: tlsOfCompany(t.companyId),
        }))
      return { title: `Pending Tasks (${rows.length})`, columns: TASK_COLUMNS, rows }
    }

    case 'executives': {
      const rows = (ctx.executives || []).map((e: any) => ({
        id: e.id,
        name: e.name || '—',
        email: e.email || '—',
        phone: e.phone || '—',
        designation: e.executiveTitle || e.designation || '—',
        companies: (e.assignedCompanyIds || []).map((cid: string) => companyMap.get(cid)).filter(Boolean).join(', ') || 'None',
        teamLeaders: (e.assignedTeamLeaderIds || []).map((id: string) => tlNameById.get(id)).filter(Boolean).join(', ') || '—',
      }))
      return { title: `Executives (${rows.length})`, columns: EXECUTIVE_COLUMNS, rows }
    }

    default:
      return null
  }
}
