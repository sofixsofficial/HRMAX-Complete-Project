const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const SA = path.join(__dirname, 'service-account.json');
admin.initializeApp({ credential: admin.credential.cert(SA) });
const db = admin.firestore();

const typeOf = (v) => {
  if (v === null || v === undefined) return String(v);
  if (v instanceof admin.firestore.Timestamp) return 'Timestamp(' + v.toDate().toISOString() + ')';
  if (v instanceof Date) return 'Date(' + v.toISOString() + ')';
  if (typeof v === 'string') return 'String(' + v.slice(0, 40) + ')';
  if (typeof v === 'number') return 'Number(' + v + ')';
  if (typeof v === 'object') return Array.isArray(v) ? 'Array[' + v.length + ']' : 'Object{' + Object.keys(v).join(',') + '}';
  return typeof v;
};

(async () => {
  try {
    const companiesSnap = await db.collection('companies').get();
    console.log('=== COMPANIES (' + companiesSnap.size + ') ===');
    companiesSnap.forEach((d) => {
      const c = d.data();
      console.log(d.id, '|', c.name, '| slug=', c.slug, '| code=', c.code, '| currency=', c.currency,
        '| payrollSettings=', JSON.stringify(c.payrollSettings || null).slice(0, 160));
    });

    const mailSnap = await db.doc('mail_config/global').get();
    console.log('\n=== mail_config/global ===');
    console.log(mailSnap.exists ? JSON.stringify({
      enabled: mailSnap.get('enabled'), host: mailSnap.get('host'), port: mailSnap.get('port'),
      encryption: mailSnap.get('encryption'), user: mailSnap.get('user'),
      fromName: mailSnap.get('fromName'), fromEmail: mailSnap.get('fromEmail'), configSource: mailSnap.get('configSource')
    }) : 'NOT SET (no SMTP configured)');

    const attSnap = await db.collection('attendance').limit(3).get();
    console.log('\n=== attendance sample ===');
    attSnap.forEach((d) => {
      const a = d.data();
      console.log('id=', d.id, 'date=', typeOf(a.date), 'status=', a.status, 'checkIn=', typeOf(a.checkIn));
    });

    const holSnap = await db.collection('holidays').limit(3).get();
    console.log('\n=== holidays sample ===');
    holSnap.forEach((d) => {
      const h = d.data();
      console.log('id=', d.id, 'name=', h.name, 'date=', typeOf(h.date), 'companyId=', h.companyId);
    });

    const leaveSnap = await db.collection('leaveRequests').limit(3).get();
    console.log('\n=== leaveRequests sample ===');
    leaveSnap.forEach((d) => {
      const l = d.data();
      console.log('id=', d.id, 'startDate=', typeOf(l.startDate), 'endDate=', typeOf(l.endDate),
        'status=', l.status, 'isPaid=', l.isPaid, 'leaveType=', l.leaveType);
    });

    const empSnap = await db.collection('employees').limit(2).get();
    console.log('\n=== employees sample ===');
    empSnap.forEach((d) => {
      const e = d.data();
      console.log('id=', d.id, 'name=', e.name, 'salary=', typeOf(e.salary), 'salaryStructureId=', e.salaryStructureId,
        'joinDate=', typeOf(e.joinDate), 'status=', e.status, 'overtimeRatePerHour=', e.overtimeRatePerHour);
    });

    const structSnap = await db.collection('salaryStructures').limit(2).get();
    console.log('\n=== salaryStructures sample ===');
    structSnap.forEach((d) => {
      const s = d.data();
      console.log('id=', d.id, 'name=', s.name, 'basicSalary=', s.basicSalary, 'hra=', s.hra, 'da=', s.da,
        'conveyance=', s.conveyance, 'medical=', s.medical, 'specialAllowance=', s.specialAllowance,
        'grossSalary=', s.grossSalary, 'pf=', s.pf, 'professionalTax=', s.professionalTax, 'overtimeRate=', s.overtimeRate);
    });
  } catch (e) {
    console.error('INSPECT FAILED:', e.message);
    process.exit(1);
  }
  process.exit(0);
})();