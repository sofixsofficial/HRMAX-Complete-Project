const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
const SA = path.join(__dirname, 'service-account.json');
admin.initializeApp({ credential: admin.credential.cert(SA) });
const db = admin.firestore();

const RUN_YEAR = 2026, RUN_MONTH = 8, DIVISOR = 26;
const toDate = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : null);

function getWorkingDays(holidays) {
  const days = new Date(Date.UTC(RUN_YEAR, RUN_MONTH + 1, 0)).getUTCDate();
  const hols = new Set(holidays.filter((h) => { const d = toDate(h.date); return d && d.getUTCFullYear() === RUN_YEAR && d.getUTCMonth() === RUN_MONTH; }).map((h) => toDate(h.date).getUTCDate()));
  let wd = 0;
  for (let i = 1; i <= days; i++) { const dow = new Date(Date.UTC(RUN_YEAR, RUN_MONTH, i)).getUTCDay(); if (dow !== 0 && dow !== 6 && !hols.has(i)) wd++; }
  return wd;
}

(async () => {
  const companySnap = await db.collection('companies').where('slug', '==', 'acme-solutions').get();
  if (companySnap.empty) { console.error('Demo company not found'); process.exit(1); }
  const companyId = companySnap.docs[0].id;

  const [att, lea, hol, emp, str] = await Promise.all([
    db.collection('attendance').where('companyId', '==', companyId).get(),
    db.collection('leaveRequests').where('companyId', '==', companyId).get(),
    db.collection('holidays').where('companyId', '==', companyId).get(),
    db.collection('employees').where('companyId', '==', companyId).get(),
    db.collection('salaryStructures').where('companyId', '==', companyId).get(),
  ]);
  const attendance = att.docs.map((d) => ({ id: d.id, ...d.data() }));
  const leaves = lea.docs.map((d) => ({ id: d.id, ...d.data() }));
  const holidays = hol.docs.map((d) => ({ id: d.id, ...d.data() }));
  const employees = emp.docs.map((d) => ({ id: d.id, ...d.data() }));
  const structures = str.docs.map((d) => ({ id: d.id, ...d.data() }));

  const workingDays = getWorkingDays(holidays);
  const holidayDays = holidays.length; // all seeded weekday
  console.log('Working days:', workingDays, '| Holiday days:', holidayDays);

  const presentFor = (userId) => {
    let present = 0, ot = 0, miss = 0;
    attendance.filter((a) => a.userId === userId).forEach((a) => {
      const d = toDate(a.date);
      if (!d || d.getUTCMonth() !== RUN_MONTH || d.getUTCFullYear() !== RUN_YEAR) return;
      if (['Present', 'Late', 'Approved'].includes(a.status)) { present++; ot += a.overtimeHours || 0; }
      if (a.status === 'Miss Punch' && !a.missedPunchRectification?.resolved) miss++;
    });
    return { present, ot, miss };
  };
  const leaveFor = (userId) => {
    let paid = 0, unpaid = 0;
    leaves.filter((l) => l.userId === userId && l.status === 'Approved').forEach((l) => {
      const s = toDate(l.startDate); const e = toDate(l.endDate);
      if (!s || !e) return;
      for (let d = new Date(s); d <= e; d = new Date(d.getTime() + 86400000)) {
        if (d.getUTCMonth() === RUN_MONTH && d.getUTCFullYear() === RUN_YEAR) {
          if (l.isPaid || ['Casual','Sick','Earned','Maternity','Paternity'].includes(l.leaveType)) paid++; else unpaid++;
        }
      }
    });
    return { paid, unpaid };
  };

  console.log('\nEmployee preview (before running payroll):');
  for (const e of employees) {
    const s = structures.find((x) => x.id === e.salaryStructureId) || null;
    const gross = s ? s.grossSalary : (e.salary || 0);
    const { present, ot, miss } = presentFor(e.userId);
    const { paid, unpaid } = leaveFor(e.userId);
    const daily = gross / DIVISOR;
    const absent = Math.max(0, workingDays - (present + paid + holidayDays) - unpaid);
    const deductions = (s ? (s.pf || 0) : 0) + (s ? (s.professionalTax || 0) : 0) + daily * unpaid + daily * absent;
    const earnings = gross + ot * ((s ? s.overtimeRate : 0) || e.overtimeRatePerHour || 0);
    console.log(`  ${e.name.padEnd(16)} gross=${String(gross).padStart(6)} present=${present} paidLv=${paid} unLv=${unpaid} hol=${holidayDays} OT=${ot}h miss=${miss} absent=${absent} net=~${Math.round(earnings - deductions)}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });