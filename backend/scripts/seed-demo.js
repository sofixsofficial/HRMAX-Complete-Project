/* eslint-disable no-console */
/**
 * Seed a self-contained demo company for the client demo: Acme Solutions Pvt Ltd.
 *
 * Creates:
 *  - companies/  (payroll settings, payslip header, leave allowances)
 *  - auth users (demo admin + 6 employees) with role custom claims + users/ docs
 *  - departments/, salaryStructures/, employees/, attendance/, leaveRequests/, holidays/
 *  - for run month Sept 2026 (monthIndex 8, year 2026)
 *
 * Usage:
 *   node backend/scripts/seed-demo.js          # create (fails if already present)
 *   node backend/scripts/seed-demo.js reset    # wipe existing demo first
 *
 * Requires backend/scripts/service-account.json (firebase-adminsdk key for hrm-sofisx).
 */
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SA = path.join(__dirname, 'service-account.json');
admin.initializeApp({ credential: admin.credential.cert(SA) });

const db = admin.firestore();
const auth = admin.auth();
const ts = admin.firestore.FieldValue.serverTimestamp;

const COMPANY_SLUG = 'acme-solutions';
const RUN_YEAR = 2026;
const RUN_MONTH = 8; // September (0-indexed)
const PASSWORD = 'Demo@123';

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDate = (y, m, d) => new Date(Date.UTC(y, m, d));

// ---- scenario definitions ------------------------------------------------
const DEPARTMENTS = [
  { name: 'Engineering', code: 'DEPT-ENG', color: '#3b82f6' },
  { name: 'HR', code: 'DEPT-HR', color: '#ec4899' },
  { name: 'Sales', code: 'DEPT-SALES', color: '#f97316' },
  { name: 'Finance', code: 'DEPT-FIN', color: '#10b981' },
];

const STRUCTURES = [
  { name: 'Tech Lead', basicSalary: 52000, hra: 20800, da: 0, conveyance: 3200, medical: 3000, specialAllowance: 6000, grossSalary: 85000, pf: 4800, professionalTax: 500, overtimeRate: 450 },
  { name: 'Senior Developer', basicSalary: 40000, hra: 16000, da: 0, conveyance: 2400, medical: 2400, specialAllowance: 4200, grossSalary: 65000, pf: 3600, professionalTax: 500, overtimeRate: 400 },
  { name: 'Accountant', basicSalary: 22000, hra: 8800, da: 0, conveyance: 1600, medical: 1500, specialAllowance: 2100, grossSalary: 36000, pf: 2100, professionalTax: 300, overtimeRate: 250 },
];

const EMPLOYEES = [
  { name: 'Aarav Sharma', email: 'aarav@acmesolutions.in', dept: 'Engineering', designation: 'Tech Lead', structure: 0, salary: 85000, overtimeRatePerHour: 450, scenario: 'late-miss' },
  { name: 'Priya Verma', email: 'priya@acmesolutions.in', dept: 'Engineering', designation: 'Senior Developer', structure: 1, salary: 65000, overtimeRatePerHour: 400, scenario: 'sick-leave' },
  { name: 'Rahul Nair', email: 'rahul@acmesolutions.in', dept: 'Engineering', designation: 'Software Engineer', structure: null, salary: 45000, overtimeRatePerHour: 0, scenario: 'clean' },
  { name: 'Sneha Kulkarni', email: 'sneha@acmesolutions.in', dept: 'Finance', designation: 'Accountant', structure: 2, salary: 36000, overtimeRatePerHour: 250, scenario: 'unpaid-leave' },
  { name: 'Kavita Reddy', email: 'kavita@acmesolutions.in', dept: 'HR', designation: 'HR Executive', structure: null, salary: 30000, overtimeRatePerHour: 0, scenario: 'clean' },
  { name: 'Vikram Singh', email: 'vikram@acmesolutions.in', dept: 'Sales', designation: 'Sales Executive', structure: null, salary: 28000, overtimeRatePerHour: 0, scenario: 'clean' },
];

const HOLIDAYS = [
  { name: 'Ganesh Chaturthi', date: utcDate(2026, 8, 11) },
  { name: 'Company Foundation Day', date: utcDate(2026, 8, 25) },
];

// Approved leave scenario: unpaid 14-15 Sep for Sneha, paid Sick 8 Sep for Priya.
const LEAVES = [
  {
    email: 'sneha@acmesolutions.in', leaveType: 'Unpaid', isPaid: false,
    start: utcDate(2026, 8, 14), end: utcDate(2026, 8, 15),
  },
  {
    email: 'priya@acmesolutions.in', leaveType: 'Sick', isPaid: true,
    start: utcDate(2026, 8, 8), end: utcDate(2026, 8, 8),
  },
];

const COMPANY_ADMIN = { name: 'Amit Rao', email: 'demo.admin@acmesolutions.in' };

// ---- permissions mirror frontend getPermissionArray -----------------------
const PERMS = {
  'company-admin': ['employees.view', 'departments.view', 'salary.view', 'salary.edit', 'payroll.view', 'attendance.view', 'leave.view', 'reports.view', 'settings.view', 'company.view', 'tasks.view'],
  employee: ['employees.view', 'departments.view', 'attendance.view', 'payroll.view', 'leave.view', 'leave.apply', 'company.view', 'tasks.view'],
};

const avatar = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=f97316&color=fff`;

// ---- working-day helpers ---------------------------------------------------
function isWeekday(y, m, d) {
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
  return dow !== 0 && dow !== 6;
}
function holidayDates() {
  const set = new Set();
  HOLIDAYS.forEach((h) => {
    const dd = h.date.getUTCDate();
    if (h.date.getUTCFullYear() === RUN_YEAR && h.date.getUTCMonth() === RUN_MONTH) set.add(dd);
  });
  return set;
}
function workingDayList() {
  const days = new Date(Date.UTC(RUN_YEAR, RUN_MONTH + 1, 0)).getUTCDate();
  const hols = holidayDates();
  const list = [];
  for (let d = 1; d <= days; d++) if (isWeekday(RUN_YEAR, RUN_MONTH, d) && !hols.has(d)) list.push(d);
  return list;
}

// ---- cleanup of an existing demo -------------------------------------------
async function deleteExisting() {
  const q = await db.collection('companies').where('slug', '==', COMPANY_SLUG).get();
  const ids = q.docs.map((d) => d.id);
  if (ids.length === 0) return;
  const companyId = ids[0];
  console.log(`[reset] wiping existing demo company ${companyId}...`);
  for (const coll of ['departments', 'salaryStructures', 'attendance', 'leaveRequests', 'holidays', 'payrollRuns', 'salarySlips']) {
    const snap = await db.collection(coll).where('companyId', '==', companyId).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  const empSnap = await db.collection('employees').where('companyId', '==', companyId).get();
  {
    const batch = db.batch();
    empSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  const userSnap = await db.collection('users').where('companyId', '==', companyId).get();
  {
    const batch = db.batch();
    userSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await db.collection('companies').doc(companyId).delete();
  const emails = empSnap.docs.map((d) => d.data().email);
  emails.push(COMPANY_ADMIN.email);
  for (const email of emails) {
    try {
      const u = await auth.getUserByEmail(email);
      await auth.deleteUser(u.uid);
    } catch { /* ignore */ }
  }
  console.log('[reset] done.');
}

// ---- main ------------------------------------------------------------------
(async () => {
  const reset = process.argv[2] === 'reset';
  if (reset) await deleteExisting();
  const existing = await db.collection('companies').where('slug', '==', COMPANY_SLUG).get();
  if (!existing.empty) {
    console.error(`Demo company '${COMPANY_SLUG}' already exists. Run with: node backend/scripts/seed-demo.js reset`);
    process.exit(1);
  }

  const companyRef = db.collection('companies').doc();
  const companyId = companyRef.id;
  const batch = db.batch();

  batch.set(companyRef, {
    name: 'Acme Solutions Pvt Ltd',
    slug: COMPANY_SLUG,
    code: 'ACME',
    email: 'payroll@acmesolutions.in',
    adminEmail: COMPANY_ADMIN.email,
    active: true,
    currency: 'INR',
    address: '2nd Floor, Business Bay, MG Road',
    city: 'Bengaluru', state: 'Karnataka', zipCode: '560001', country: 'India',
    phone: '+91 80 1234 5678', website: 'https://acmesolutions.in',
    payrollSettings: { salaryCycle: 'Monthly', workingDaysPerMonth: 26, weekends: [0, 6], overtimeRatePerHour: 400 },
    leaveAllowances: { Casual: 12, Sick: 12, Earned: 15, Unpaid: 0, Maternity: 84, Paternity: 5 },
    employeeCount: EMPLOYEES.length,
    createdBy: 'demo-seed', createdByName: 'Demo Seed', createdAt: ts(),
  });

  const deptIds = {};
  DEPARTMENTS.forEach((dep) => {
    const ref = db.collection('departments').doc();
    deptIds[dep.name] = ref.id;
    batch.set(ref, { ...dep, companyId, employeeCount: EMPLOYEES.filter((e) => e.dept === dep.name).length, createdAt: ts() });
  });

  const structIds = [];
  STRUCTURES.forEach((st) => {
    const ref = db.collection('salaryStructures').doc();
    structIds.push(ref.id);
    batch.set(ref, { name: st.name, companyId, ...st, createdAt: ts(), updatedAt: ts() });
  });

  // auth users + users docs
  const authUsers = [];
  const makeUser = async (name, email, role) => {
    const created = await auth.createUser({ email, password: PASSWORD, displayName: name });
    await auth.setCustomUserClaims(created.uid, { role, companyId });
    return created.uid;
  };
  const adminUid = await makeUser(COMPANY_ADMIN.name, COMPANY_ADMIN.email, 'company-admin');
  authUsers.push({ uid: adminUid, name: COMPANY_ADMIN.name, email: COMPANY_ADMIN.email, role: 'company-admin' });
  for (const e of EMPLOYEES) {
    const uid = await makeUser(e.name, e.email, 'employee');
    authUsers.push({ uid, name: e.name, email: e.email, role: 'employee' });
  }
  for (const au of authUsers) {
    batch.set(db.collection('users').doc(au.uid), {
      id: au.uid, uid: au.uid, name: au.name, email: au.email, username: au.email.split('@')[0],
      password: '', requirePasswordChange: false, role: au.role, companyId,
      departmentId: au.role === 'employee' ? deptIds[EMPLOYEES.find((e) => e.email === au.email)?.dept] : null,
      department: au.role === 'employee' ? EMPLOYEES.find((e) => e.email === au.email)?.dept : '',
      avatar: avatar(au.name),
      permissions: PERMS[au.role] || [],
      isActive: true, status: 'Active', isApproved: true,
      phone: '', employmentType: 'Full-time',
      joinDate: au.role === 'employee' ? utcDate(2023, 0, 15) : utcDate(2020, 5, 1),
      createdAt: ts(),
    });
  }

  // employees + attendance
  const empUserId = {}; // email -> userId
  const empIds = {};
  const workingDays = workingDayList();
  for (const [i, e] of EMPLOYEES.entries()) {
    const uid = authUsers.find((a) => a.email === e.email).uid;
    empUserId[e.email] = uid;
    const rec = db.collection('employees').doc();
    empIds[e.email] = rec.id;
    const dept = e.dept;
    batch.set(rec, {
      companyId, userId: uid, slug: e.name.toLowerCase().replace(/\s+/g, '-'),
      name: e.name, email: e.email, employeeId: `EMP-${String(i + 1).padStart(4, '0')}`,
      userName: e.name, department: dept, departmentId: deptIds[dept], departmentColor: DEPARTMENTS.find((d) => d.name === dept).color,
      designation: e.designation, status: 'Active', joinDate: utcDate(2023, 0, 15),
      avatar: avatar(e.name), phone: '', isReportingManager: false,
      salary: e.salary, salaryStructureId: e.structure != null ? structIds[e.structure] : '',
      overtimeRatePerHour: e.overtimeRatePerHour, workingDaysPerMonth: 26, weekendDays: [0, 6],
      createdAt: ts(),
    });
  }

  // attendance: Present on every working day, then apply scenario rows
  const attendRefs = {};
  const punch = (email, day, status, cin, cout, ot = 0) => {
    const ref = db.collection('attendance').doc();
    const d = utcDate(RUN_YEAR, RUN_MONTH, day);
    const mk = (hh, mm) => new Date(d.getTime() + ((hh * 60 + mm) * 60 * 1000));
    const doc = {
      companyId, userId: empUserId[email], name: EMPLOYEES.find((x) => x.email === email).name,
      date: d, status, overtimeHours: ot,
    };
    if (cin) doc.checkIn = mk(cin[0], cin[1]);
    if (cout) doc.checkOut = mk(cout[0], cout[1]);
    (attendRefs[email] = attendRefs[email] || []).push({ ref, doc });
  };

  const leaveDaysFor = (email) => {
    const days = new Set();
    LEAVES.filter((l) => l.email === email).forEach((l) => {
      for (let dd = l.start; dd <= l.end; dd = new Date(dd.getTime() + DAY_MS)) days.add(dd.getUTCDate());
    });
    return days;
  };

  for (const e of EMPLOYEES) {
    const skip = leaveDaysFor(e.email);
    const scenario = e.scenario;
    for (const day of workingDays) {
      if (skip.has(day)) continue;
      let status = 'Present', cin = [9, 30], cout = [18, 30], ot = 0;
      if (scenario === 'late-miss') {
        if (day === 3 || day === 17) { status = 'Late'; cin = [10, 42]; }
        if (day === 24) { status = 'Miss Punch'; cin = [9, 12]; cout = null; ot = 0; }
        if (day === 15) ot = 3;
        if (day === 21) ot = 3;
        if (day === 28) ot = 2;
      }
      punch(e.email, day, status, cin, cout, ot);
    }
  }
  for (const key of Object.keys(attendRefs)) {
    attendRefs[key].forEach(({ ref, doc }) => batch.set(ref, doc));
  }

  // leaveRequests
  for (const [i, lv] of LEAVES.entries()) {
    const ref = db.collection('leaveRequests').doc();
    const emp = EMPLOYEES.find((e) => e.email === lv.email);
    const totalDays = Math.round((lv.end.getTime() - lv.start.getTime()) / DAY_MS) + 1;
    const approverName = { reportingManager: 'Amit Rao', companyAdmin: 'Amit Rao', executive: 'Master Admin', teamLeader: 'Master Admin' };
    batch.set(ref, {
      companyId, userId: empUserId[lv.email],
      employeeName: emp.name, employeeId: `EMP-${String(EMPLOYEES.indexOf(emp) + 1).padStart(4, '0')}`,
      employeeEmail: emp.email, avatar: avatar(emp.name),
      department: emp.dept, departmentId: deptIds[emp.dept],
      leaveType: lv.leaveType, startDate: lv.start, endDate: lv.end, totalDays,
      reason: lv.leaveType === 'Unpaid' ? 'Personal work - unpaid' : 'Not feeling well',
      status: 'Approved', isPaid: lv.isPaid, appliedOn: utcDate(RUN_YEAR, RUN_MONTH - 1, 25),
      applicantRole: 'employee', masterAdminRequired: false,
      approvalStatus: { reportingManager: 'Approved', companyAdmin: 'Approved', executive: 'Approved', teamLeader: 'Approved' },
      approverIds: { reportingManager: adminUid, companyAdmin: adminUid, executive: adminUid, teamLeader: adminUid },
      approvalLog: [
        { tier: 'reportingManager', status: 'Approved', approvedBy: adminUid, approvedByName: approverName.reportingManager, approvedOn: utcDate(RUN_YEAR, RUN_MONTH - 1, 25), note: 'Auto-approved (manager)' },
        { tier: 'companyAdmin', status: 'Approved', approvedBy: adminUid, approvedByName: approverName.companyAdmin, approvedOn: utcDate(RUN_YEAR, RUN_MONTH - 1, 26), note: 'Approved' },
        { tier: 'executive', status: 'Approved', approvedBy: adminUid, approvedByName: approverName.executive, approvedOn: utcDate(RUN_YEAR, RUN_MONTH - 1, 27), note: 'Approved' },
        { tier: 'teamLeader', status: 'Approved', approvedBy: adminUid, approvedByName: approverName.teamLeader, approvedOn: utcDate(RUN_YEAR, RUN_MONTH - 1, 28), note: 'Approved' },
      ],
      createdAt: ts(),
    });
  }

  // holidays
  HOLIDAYS.forEach((h) => {
    batch.set(db.collection('holidays').doc(), { companyId, name: h.name, date: h.date, createdAt: ts(), createdBy: adminUid, createdByName: COMPANY_ADMIN.name });
  });

  console.log('Committing', batch._ops ? batch._ops.length : '~many', 'writes...');
  await batch.commit();

  console.log('\n==== DEMO SEEDED ====');
  console.log('Company        :', 'Acme Solutions Pvt Ltd', `(${companyId})`);
  console.log('Run period      :', 'September 2026 (provisional attendance)');
  console.log('Working days    :', workingDays.length, '(weekdays minus', HOLIDAYS.length, 'floating holiday)', '| divisor 26');
  console.log('Employees       :', EMPLOYEES.length);
  console.log('Login (admin)   :', COMPANY_ADMIN.email, '/', PASSWORD);
  EMPLOYEES.forEach((e, i) => console.log(`  Employee ${i + 1}  :`, e.email, '/', PASSWORD));
  console.log('\nScenarios baked in:');
  console.log('  - Aarav  : 2 Late, 1 unresolved Miss Punch, 8h overtime');
  console.log('  - Priya  : 1 approved Sick (paid) leave');
  console.log('  - Sneha  : 2 approved Unpaid leave days (loss-of-pay deduction)');
  console.log('  - 2 weekday holidays (11 & 25 Sep)');
  console.log('\nNext steps:');
  console.log(' 1. Deploy fixed functions: npm run deploy:functions');
  console.log(' 2. Configure SMTP: Dashboard -> Email System');
  console.log(' 3. Log in as', COMPANY_ADMIN.email, '-> Payroll, run September 2026');
})().catch((e) => { console.error('SEED FAILED:', e); process.exit(1); });