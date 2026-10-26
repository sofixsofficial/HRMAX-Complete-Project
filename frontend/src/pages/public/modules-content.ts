/**
 * Product module documentation.
 *
 * Every capability listed here was verified against the HR MAX source:
 * route registrations in App.tsx, backend handlers in
 * backend/aws/src/handlers, and the attendance settings panel
 * (office geofence radius, Wi-Fi SSID, selfie, grace period, auto-checkout).
 *
 * NO invented statistics, certifications, integrations or customer claims.
 */

export interface Capability {
  title: string
  body: string
}

export interface ModuleDoc {
  slug: string
  navLabel: string
  eyebrow: string
  h1: string
  lede: string
  problem: string
  workflow: string[]
  capabilities: Capability[]
  whoBenefits: string
  related: { label: string; to: string }[]
  faqs: { q: string; a: string }[]
}

export const modules: ModuleDoc[] = [
  {
    slug: 'employee-management',
    navLabel: 'Employee Management',
    eyebrow: 'Module',
    h1: 'Employee Management',
    lede:
      'Keep one dependable record per employee — personal details, department, designation, reporting line and account status — searchable by everyone who is permitted to see it.',
    problem:
      'Employee information usually lives across spreadsheets, inboxes and separate HR tools. When a department changes or someone reports to a new manager, the record goes stale and payroll, attendance and reporting all disagree.',
    workflow: [
      'An administrator creates the employee record and assigns a company, department and designation.',
      'The employee receives sign-in access and their role determines what they can see.',
      'The reporting hierarchy is set — manager, reporting manager, team leader or executive.',
      'Search and filters narrow the list by department, role, status or company.',
      'Changes are recorded with an updated timestamp so records stay current.',
    ],
    capabilities: [
      {
        title: 'Employee profiles and records',
        body: 'Name, email, phone, department, designation, employment type, company assignment and account status held in one record per person.',
      },
      {
        title: 'Onboarding and status',
        body: 'Create an employee with a temporary password, then track account status — active, inactive or pending — from the same list.',
      },
      {
        title: 'Department, designation and reporting hierarchy',
        body: 'Employees belong to a department and report to a manager, reporting manager or team leader, so approvals and dashboards follow the real structure.',
      },
      {
        title: 'Search and filtering',
        body: 'Filter by department, role, status and company, with pagination and CSV export for offline review.',
      },
      {
        title: 'Role-based access',
        body: 'Each employee only sees the records their role permits. Company-scoped roles are separated from cross-company administrators.',
      },
    ],
    whoBenefits:
      'HR administrators who maintain records, department heads who need their team list, and managers who approve leave and attendance for their reports.',
    related: [
      { label: 'Organization & Access Control', to: '/modules/organization-management' },
      { label: 'Leave Management', to: '/modules/leave-management' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics' },
    ],
    faqs: [
      {
        q: 'Can employees see their own record?',
        a: 'Yes. Employees can open their own profile and update the personal details their role permits, while records belonging to other people stay restricted by role permissions.',
      },
      {
        q: 'Can one person belong to more than one company?',
        a: 'Company assignment is stored per employee, and administrators can be granted access across multiple companies. Confirm your exact configuration with the HR MAX team during onboarding.',
      },
    ],
  },
  {
    slug: 'attendance',
    navLabel: 'Attendance & Time',
    eyebrow: 'Module',
    h1: 'Attendance Management',
    lede:
      'Record check-in and check-out with configurable location and network validation, then review daily and historical attendance with clear summaries.',
    problem:
      'Manual attendance — registers, sign-in sheets, chat messages — is hard to verify and slow to reconcile. Late arrivals, missed punches and remote work make the monthly record unreliable.',
    workflow: [
      'An administrator configures the attendance policy: shift timings, grace period and validation mode.',
      'Employees check in from the app; the request is validated against the configured rules.',
      'Check-out closes the day, and auto-checkout handles anyone who forgets.',
      'Missed or incorrect punches are raised as requests and approved by the appropriate manager.',
      'Attendance records feed summaries, reports and payroll.',
    ],
    capabilities: [
      {
        title: 'Check-in and check-out',
        body: 'Employees record their own attendance from the app, with the day\'s status derived from shift start, grace period and late threshold.',
      },
      {
        title: 'GPS-based validation',
        body: 'Attendance can be restricted to an office location with a configurable geofence radius, so check-ins must happen at the workplace.',
      },
      {
        title: 'Wi-Fi and mobile network validation',
        body: 'Optionally require employees to be connected to a named office Wi-Fi network before a check-in is accepted, or allow mobile data explicitly.',
      },
      {
        title: 'Selfie verification',
        body: 'A selfie can be captured at check-in so the record carries visual confirmation alongside the location.',
      },
      {
        title: 'Missed-punch requests',
        body: 'Employees raise a missed-punch or correction request inside a defined correction window, and a manager approves or rejects it.',
      },
      {
        title: 'Shift configuration',
        body: 'Default shift start and end, grace period, late threshold, weekend days, holiday calendar and auto-checkout are all policy settings.',
      },
      {
        title: 'Attendance reporting',
        body: 'Daily and historical records, summaries and exportable reports for review, payroll input or audit.',
      },
    ],
    whoBenefits:
      'Organizations with office-based teams, hybrid or field workforce, and HR teams that need verifiable daily attendance without chasing people.',
    related: [
      { label: 'Leave Management', to: '/modules/leave-management' },
      { label: 'Payroll', to: '/modules/payroll' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics' },
    ],
    faqs: [
      {
        q: 'How does attendance tracking work?',
        a: 'Employees check in and check out from the app. The server validates the request against the configured attendance policy — including location, network and selfie rules where they are enabled — and stores the resulting record for reporting.',
      },
      {
        q: 'How are missed punches handled?',
        a: 'An employee raises a correction request within the configured correction window. The request is reviewed and approved before the attendance record is amended.',
      },
      {
        q: 'Can attendance rules differ between offices?',
        a: 'Attendance policy is configured per company. Multiple offices with separate companies can carry separate policies — confirm the exact setup with the HR MAX team.',
      },
    ],
  },
  {
    slug: 'leave-management',
    navLabel: 'Leave Management',
    eyebrow: 'Module',
    h1: 'Leave Management',
    lede:
      'Employees request time off, managers approve it, and everyone sees balances and history without a single spreadsheet.',
    problem:
      'Leave tracked over chat or email creates double bookings, unclear balances and no audit trail. Managers approve without seeing who else is away, and month-end reconciliation becomes guesswork.',
    workflow: [
      'An employee submits a leave request with dates and a reason.',
      'The request enters an approval queue for the responsible approver.',
      'The approver reviews, then approves or rejects with the request history in view.',
      'Balances and history update so both the employee and HR see the same numbers.',
      'Leave records feed attendance and reporting.',
    ],
    capabilities: [
      {
        title: 'Leave requests',
        body: 'Employees raise requests for the dates they need, with the reason attached to the record.',
      },
      {
        title: 'Approval workflow',
        body: 'Requests route to the responsible manager or HR reviewer, who can approve or reject with full context.',
      },
      {
        title: 'Balances and ledgers',
        body: 'Employees see their own balance and past requests; approvers see team availability before deciding.',
      },
      {
        title: 'History and reporting',
        body: 'Approved, pending and rejected leave is queryable and exportable for HR review and payroll input.',
      },
    ],
    whoBenefits:
      'Employees who need a clear way to request time off, managers approving requests, and HR teams who need an accurate picture of who is away.',
    related: [
      { label: 'Attendance Management', to: '/modules/attendance' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics' },
      { label: 'Employee Management', to: '/modules/employee-management' },
    ],
    faqs: [
      {
        q: 'How do employees request leave?',
        a: 'From the leave screen in the app, an employee selects the dates and reason and submits the request. It then appears in the approver\'s queue.',
      },
      {
        q: 'Who approves leave requests?',
        a: 'Approval routes to the manager or reviewer configured for that employee. Your exact routing depends on your organization setup.',
      },
      {
        q: 'How are leave balances calculated?',
        a: 'Balances follow the policy configured for your organization. Ask the HR MAX team to confirm how accrual is applied for your plan.',
      },
    ],
  },
  {
    slug: 'payroll',
    navLabel: 'Payroll',
    eyebrow: 'Module',
    h1: 'Payroll and Compensation',
    lede:
      'Define salary structures, run payroll calculations and produce per-employee salary slips — with the same employee and attendance data you already trust.',
    problem:
      'Payroll prepared separately from attendance and employee records means re-keying data, silent discrepancies and late corrections when someone joins, changes department or takes leave.',
    workflow: [
      'Employees are assigned salary structures.',
      'Payroll is calculated against the configured inputs for the period.',
      'Results are reviewed before they are finalized.',
      'Salary slips are generated per employee.',
      'Payroll history and salary slips stay available for reference and export.',
    ],
    capabilities: [
      {
        title: 'Payroll calculation',
        body: 'Run a payroll calculation for the selected company and period, and review the result before it is treated as final.',
      },
      {
        title: 'Salary structure',
        body: 'Define compensation components per employee so payroll calculations follow a consistent structure.',
      },
      {
        title: 'Salary slips',
        body: 'Generate and view per-employee salary slips, with PDF generation available through the application\'s document tooling.',
      },
      {
        title: 'Payroll history',
        body: 'Completed runs remain queryable so finance can revisit a period without reconstructing it from spreadsheets.',
      },
      {
        title: 'Exports',
        body: 'Payroll and salary data can be exported for finance review using the application\'s CSV and PDF export tools.',
      },
    ],
    whoBenefits:
      'Finance and HR teams who run monthly payroll, and administrators who need per-employee compensation records to stay consistent.',
    related: [
      { label: 'Attendance Management', to: '/modules/attendance' },
      { label: 'Employee Management', to: '/modules/employee-management' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics' },
    ],
    faqs: [
      {
        q: 'Does HR MAX support payroll?',
        a: 'Yes. HR MAX includes payroll calculation, salary structures, salary slips and payroll history. Confirm which payroll workflows apply to your plan with the HR MAX team.',
      },
      {
        q: 'Can payroll reports be exported?',
        a: 'Payroll and salary data can be exported using the CSV and PDF export available in the application. Available exports can be confirmed during your demo.',
      },
    ],
  },
  {
    slug: 'task-management',
    navLabel: 'Task Management',
    eyebrow: 'Module',
    h1: 'Task and Work Management',
    lede:
      'Assign work to individuals or teams, track status as it moves, and give supervisors a single view of what is outstanding.',
    problem:
      'Work handed over verbally or in chat has no owner, no due date and no record. Supervisors spend time chasing updates instead of reviewing results.',
    workflow: [
      'A manager or team lead creates a task and assigns it to an employee or team.',
      'The assignee updates status as work progresses.',
      'The supervisor sees outstanding, in-progress and completed work in one place.',
      'Reporting rolls task activity into the wider team view.',
    ],
    capabilities: [
      {
        title: 'Task creation and assignment',
        body: 'Create tasks with an owner so responsibility is explicit rather than assumed.',
      },
      {
        title: 'Team-level tracking',
        body: 'View work across a team or department, not just an individual to-do list.',
      },
      {
        title: 'Status updates',
        body: 'Move tasks through their statuses so progress is visible without a follow-up meeting.',
      },
      {
        title: 'Supervisor and team-leader workflows',
        body: 'Team leaders and executives see assigned work for the people they are responsible for.',
      },
    ],
    whoBenefits:
      'Team leaders distributing work, executives tracking delivery, and employees who need one list of what is expected of them.',
    related: [
      { label: 'Employee Management', to: '/modules/employee-management' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics' },
      { label: 'Solutions for HR Teams', to: '/solutions/hr-teams' },
    ],
    faqs: [
      {
        q: 'Can tasks be assigned to a whole team?',
        a: 'Tasks are assigned to employees, and team views aggregate that work for the responsible leader. Ask the HR MAX team about bulk assignment for your plan.',
      },
    ],
  },
  {
    slug: 'reports-analytics',
    navLabel: 'Reports & Analytics',
    eyebrow: 'Module',
    h1: 'Reports and Analytics',
    lede:
      'Turn attendance, leave, payroll and employee records into reports your leadership can read — with CSV and PDF export when a document is required.',
    problem:
      'Decisions get delayed when every question about the workforce requires a manual extract. Leadership wants a reliable answer now, not next week.',
    workflow: [
      'Choose the dataset — attendance, employees, leave, payroll or tasks.',
      'Filter by company, department, date range or status.',
      'Review the summary and detail on screen.',
      'Export to CSV or PDF when the result needs to be shared or filed.',
    ],
    capabilities: [
      {
        title: 'Attendance reports',
        body: 'Daily and period attendance views with status breakdowns for review and payroll input.',
      },
      {
        title: 'Employee summaries',
        body: 'Headcount and employee listings filtered by company, department, role and status.',
      },
      {
        title: 'Leave analytics',
        body: 'Approved, pending and rejected leave by person, team and period.',
      },
      {
        title: 'Payroll reports',
        body: 'Payroll results and salary records for finance review.',
      },
      {
        title: 'Task reports',
        body: 'Outstanding and completed work by owner and team.',
      },
      {
        title: 'Export',
        body: 'CSV and PDF export built into the application for sharing and record-keeping.',
      },
    ],
    whoBenefits:
      'HR leaders preparing management reviews, finance teams reconciling payroll, and executives who want current workforce numbers.',
    related: [
      { label: 'Attendance Management', to: '/modules/attendance' },
      { label: 'Payroll', to: '/modules/payroll' },
      { label: 'Organization & Access Control', to: '/modules/organization-management' },
    ],
    faqs: [
      {
        q: 'Which reports are available?',
        a: 'Attendance, employee, leave, payroll and task reporting are available from their respective modules, with CSV and PDF export where supported.',
      },
      {
        q: 'Can reports be filtered by department?',
        a: 'Reports support filtering by company, department, role, status and date range depending on the dataset.',
      },
    ],
  },
  {
    slug: 'organization-management',
    navLabel: 'Organization & Access',
    eyebrow: 'Module',
    h1: 'Organization and Access Control',
    lede:
      'Model the way your company is actually structured — multiple companies, departments and roles — and control precisely what each role can do.',
    problem:
      'When structure lives only in someone\'s head, permissions become all-or-nothing. Either too many people can see payroll, or the people who need data cannot get it.',
    workflow: [
      'Companies and departments are created to mirror the real organization.',
      'Roles are assigned: master administrator, company administrator, executive, team leader, reporting manager or employee.',
      'A permission matrix is saved per role, module by module.',
      'Access requests and company approvals are reviewed before accounts go live.',
      'Sensitive actions are written to the audit trail.',
    ],
    capabilities: [
      {
        title: 'Multi-company separation',
        body: 'Each company keeps its own employees, departments and settings, so data does not bleed between organizations.',
      },
      {
        title: 'Role-based permission matrix',
        body: 'Permissions are granted per module and action — view, create, edit, delete, approve — rather than one blanket role.',
      },
      {
        title: 'Administrative dashboards',
        body: 'Company administrators manage their own organization; master administrators oversee every company.',
      },
      {
        title: 'Company approval workflow',
        body: 'New company administrator requests are held for review before the account becomes active.',
      },
      {
        title: 'Audit trail',
        body: 'Configuration and security-sensitive actions — including password changes — are recorded with actor, action and timestamp.',
      },
      {
        title: 'Password and account management',
        body: 'Password policy enforcement, reset codes and account status controls keep access governed.',
      },
    ],
    whoBenefits:
      'Master administrators setting the rules, company administrators running one organization, and security-conscious leaders who need to know who can see what.',
    related: [
      { label: 'Employee Management', to: '/modules/employee-management' },
      { label: 'Security', to: '/security' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics' },
    ],
    faqs: [
      {
        q: 'How are employee permissions managed?',
        a: 'Permissions are stored per role in a module-by-module matrix. An administrator edits the matrix and saves it; access is evaluated against those permissions on every request.',
      },
      {
        q: 'What can an administrator access?',
        a: 'It depends on the role. A company administrator is scoped to their own organization, while a master administrator can operate across companies. The permission matrix further narrows individual modules.',
      },
      {
        q: 'Can access differ by role?',
        a: 'Yes — that is the core of the model. Roles carry different permission sets, and company-scoped roles are additionally limited to their own company\'s data.',
      },
    ],
  },
]

export const moduleBySlug = (slug: string) => modules.find(m => m.slug === slug)
