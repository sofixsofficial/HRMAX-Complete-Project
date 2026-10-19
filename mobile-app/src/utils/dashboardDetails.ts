export interface CardDetailConfig {
  title: string;
  columns: { key: string; label: string }[];
  rows: Record<string, any>[];
}

interface DetailCtx {
  records: {
    companies: any[];
    employees: any[];
    attendanceToday: any[];
    missPunchRecords?: any[];
    leaves: any[];
    tasks: any[];
  };
  counts: {
    totalEmployees?: number;
    activeEmployees?: number;
    inactiveEmployees?: number;
    presentToday?: number;
    absentToday?: number;
    lateToday?: number;
    onLeaveToday?: number;
    missPunchToday?: number;
    approvedAttendanceToday?: number;
    pendingLeaves?: number;
    totalLeaveRequests?: number;
    approvedLeaves?: number;
    rejectedLeaves?: number;
    pendingTasks?: number;
  };
  executives?: any[];
  teamLeaders?: any[];
}

const fmtDate = (v: any): string => {
  if (!v) return '—';
  const d = v?.toDate?.() || (v instanceof Date ? v : new Date(v));
  return isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtTime = (v: any): string => {
  if (!v) return '—';
  if (typeof v === 'string') return v;
  const d = v?.toDate?.() || v;
  return d instanceof Date && !isNaN(d.getTime())
    ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : String(v);
};

export function getCardDetailConfig(key: string, ctx: DetailCtx): CardDetailConfig | null {
  const { records, counts } = ctx;

  const companyMap = new Map(records.companies.map((c: any) => [c.id, c.name || '—']));
  const companyNameOf = (cid: any) => (cid && companyMap.get(cid)) || '—';
  const employeeNameOf = (userId?: string) =>
    records.employees.find((e: any) => e.userId === userId)?.name || '';

  // Ownership columns: which Executive / Team Leader a record falls under
  const execOfCompany = (cid: any): string => {
    if (!cid) return '—';
    const c = records.companies.find((x: any) => x.id === cid);
    if (c?.assignedExecutiveName) return c.assignedExecutiveName;
    const ex = (ctx.executives || []).find((x: any) => (x.assignedCompanyIds || []).includes(cid));
    return ex?.name || '—';
  };
  const tlsOfCompany = (cid: any): string => {
    if (!cid) return '—';
    const names = (ctx.teamLeaders || [])
      .filter((tl: any) => tl.companyId === cid || (tl.assignedCompanyIds || []).includes(cid))
      .map((tl: any) => tl.name)
      .filter(Boolean);
    return names.join(', ') || '—';
  };
  const tlNameById = new Map((ctx.teamLeaders || []).map((t: any) => [t.id, t.name]));

  const employeeRow = (e: any) => ({
    id: e.id,
    name: e.name || [e.firstName, e.lastName].filter(Boolean).join(' ') || '—',
    company: companyNameOf(e.companyId),
    executive: execOfCompany(e.companyId),
    teamLeader: tlsOfCompany(e.companyId),
    empId: e.employeeId || e.empCode || '—',
    department: e.department || e.departmentName || '—',
    designation: e.designation || e.jobTitle || '—',
    status: e.status || '—',
  });

  const attendanceRow = (a: any) => ({
    id: a.id,
    name: a.name || employeeNameOf(a.userId) || '—',
    company: companyNameOf(a.companyId),
    executive: execOfCompany(a.companyId),
    teamLeader: tlsOfCompany(a.companyId),
    checkIn: fmtTime(a.checkIn),
    date: fmtDate(a.date),
  });

  const attendanceRowsFrom = (list: any[]) => list.filter(Boolean).map(attendanceRow);

  const attendanceRows = (statuses: string[]) =>
    attendanceRowsFrom(records.attendanceToday.filter((a: any) => statuses.includes(a.status)));

  const leaveRows = (status?: string) =>
    records.leaves
      .filter((l: any) => !status || l.status === status)
      .map((l: any) => ({
        id: l.id,
        name: l.employeeName || l.userName || employeeNameOf(l.userId) || '—',
        company: companyNameOf(l.companyId),
        executive: execOfCompany(l.companyId),
        teamLeader: tlsOfCompany(l.companyId),
        leaveType: l.leaveType || '—',
        from: fmtDate(l.startDate || l.fromDate),
        to: fmtDate(l.endDate || l.toDate),
        status: l.status || '—',
      }));

  switch (key) {
    case 'employees':
      return { title: `Employee Details (${counts.totalEmployees ?? records.employees.length})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'empId', label: 'Employee ID' },
        { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' }, { key: 'status', label: 'Status' },
      ], rows: records.employees.map(employeeRow) };

    case 'active-employees':
      return { title: `Active Employees (${counts.activeEmployees ?? 0})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
      ], rows: records.employees.filter((e: any) => e.status === 'Active').map(employeeRow) };

    case 'inactive-employees':
      return { title: `Inactive Employees (${counts.inactiveEmployees ?? 0})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'department', label: 'Department' }, { key: 'status', label: 'Status' },
      ], rows: records.employees.filter((e: any) => e.status === 'Inactive').map(employeeRow) };

    case 'total-companies': {
      const rows = records.companies.map((c: any) => ({
        id: c.id,
        name: c.name || '—',
        executive: execOfCompany(c.id),
        teamLeader: tlsOfCompany(c.id),
        employees: records.employees.filter((e: any) => e.companyId === c.id).length,
        status: c.status || '—',
      }));
      return { title: `Company Details (${rows.length})`, columns: [
        { key: 'name', label: 'Company Name' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'employees', label: 'Employees' }, { key: 'status', label: 'Status' },
      ], rows };
    }

    case 'present':
      return { title: `Present Employees (${counts.presentToday ?? 0})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'checkIn', label: 'Check-In' }, { key: 'date', label: 'Date' },
      ], rows: attendanceRows(['Present']) };

    case 'absent':
      return { title: `Absent Employees (${counts.absentToday ?? 0})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'date', label: 'Date' },
      ], rows: attendanceRows(['Absent']) };

    case 'late':
      return { title: `Late Employees (${counts.lateToday ?? 0})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'checkIn', label: 'Check-In' }, { key: 'date', label: 'Date' },
      ], rows: attendanceRows(['Late']) };

    case 'on-leave':
      return { title: `Employees On Leave (${counts.onLeaveToday ?? 0})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'department', label: 'Department' },
      ], rows: records.attendanceToday.filter((a: any) => a.status === 'On Leave').map((a: any) => ({
        id: a.id,
        name: a.name || employeeNameOf(a.userId) || '—',
        company: companyNameOf(a.companyId),
        executive: execOfCompany(a.companyId),
        teamLeader: tlsOfCompany(a.companyId),
        department: records.employees.find((e: any) => e.userId === a.userId)?.department || '—',
      })) };

    case 'miss-punch':
      return { title: `Missed Punch (${counts.missPunchToday ?? 0})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'checkIn', label: 'Check-In' }, { key: 'date', label: 'Date' },
      ], rows: records.missPunchRecords
        ? attendanceRowsFrom(records.missPunchRecords)
        : attendanceRows(['Miss Punch', 'MissPunch', 'miss-punch', 'miss_punch'])
      };

    case 'approved-attendance':
      return { title: `Approved Attendance (${counts.approvedAttendanceToday ?? 0})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'checkIn', label: 'Check-In' }, { key: 'date', label: 'Date' },
      ], rows: attendanceRows(['Approved']) };

    case 'leaves-pending':
      return { title: `Pending Leave Requests (${counts.pendingLeaves ?? 0})`, columns: [
        { key: 'name', label: 'Employee' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'leaveType', label: 'Leave Type' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' },
      ], rows: leaveRows('Pending') };

    case 'leaves-total':
      return { title: `All Leave Requests (${counts.totalLeaveRequests ?? 0})`, columns: [
        { key: 'name', label: 'Employee' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'leaveType', label: 'Leave Type' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' }, { key: 'status', label: 'Status' },
      ], rows: leaveRows() };

    case 'leaves-approved':
      return { title: `Approved Leaves (${counts.approvedLeaves ?? 0})`, columns: [
        { key: 'name', label: 'Employee' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'leaveType', label: 'Leave Type' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' },
      ], rows: leaveRows('Approved') };

    case 'leaves-rejected':
      return { title: `Rejected Leaves (${counts.rejectedLeaves ?? 0})`, columns: [
        { key: 'name', label: 'Employee' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'leaveType', label: 'Leave Type' }, { key: 'from', label: 'From' }, { key: 'to', label: 'To' },
      ], rows: leaveRows('Rejected') };

    case 'tasks-pending': {
      const rows = records.tasks
        .filter((t: any) => t.status === 'Pending' || t.status === 'todo')
        .map((t: any) => ({
          id: t.id,
          title: t.title || '—',
          assignedTo: t.assignedTo || '—',
          company: companyNameOf(t.companyId),
          executive: execOfCompany(t.companyId),
          teamLeader: tlsOfCompany(t.companyId),
          dueDate: fmtDate(t.dueDate),
          priority: t.priority || '—',
        }));
      return { title: `Pending Tasks (${rows.length})`, columns: [
        { key: 'title', label: 'Task' }, { key: 'assignedTo', label: 'Assigned To' }, { key: 'company', label: 'Company' },
        { key: 'executive', label: 'Executive' }, { key: 'teamLeader', label: 'Team Leader' },
        { key: 'dueDate', label: 'Due Date' }, { key: 'priority', label: 'Priority' },
      ], rows };
    }

    case 'executives': {
      const rows = (ctx.executives || []).map((e: any) => ({
        id: e.id,
        name: e.name || '—',
        email: e.email || '—',
        companies: (e.assignedCompanyIds || []).length,
        teamLeaders: (e.assignedTeamLeaderIds || []).map((id: string) => tlNameById.get(id)).filter(Boolean).join(', ') || '—',
      }));
      return { title: `Executives (${rows.length})`, columns: [
        { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'companies', label: 'Companies' },
        { key: 'teamLeaders', label: 'Team Leaders' },
      ], rows };
    }

    default:
      return null;
  }
}
