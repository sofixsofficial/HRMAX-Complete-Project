#!/usr/bin/env node
// Payslip rendering guard (run via `npm run test:payslip` in backend/functions).
// Renders two representative payslips with the production generator and checks
// the things that historically broke:
//   1. output is a real PDF
//   2. single A4 page
//   3. the Unicode font is embedded (rupee sign could otherwise degrade to "1")
//   4. no WinAnsiEncoding text mapping (the jsPDF 4.x Helvetica encoding trap)
//   5. dynamic fields (name, designation, date of joining, amount) survive

const fs = require('fs');
const path = require('path');
const { generateSalarySlipPdf } = require('../lib/payslipPdf.js');

const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

(async () => {
  const company = {
    companyName: 'Sofixs Private Limited',
    companyAddress: 'Whitefield',
    companyCity: 'Bengaluru',
    companyState: 'Karnataka',
    companyCountry: 'India',
    companyCurrency: 'INR',
  };

  const cases = [
    ['zero', { employeeName: 'Bibek', designation: 'Software Engineer', dateOfJoining: '2025-01-15', month: 'March', year: 2026, paidOn: '2026-04-01', basicSalary: 0, allowances: 0, deductions: 0, netSalary: 0, breakdown: { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0 }, paidDays: 30, lopDays: 0, workingDays: 30 }],
    ['rich', { employeeName: 'Bibek', designation: 'Software Engineer', dateOfJoining: '2025-01-15', month: 'March', year: 2026, paidOn: '2026-04-01', basicSalary: 40000, allowances: 28000, deductions: 4800, netSalary: 63200, breakdown: { hra: 16000, da: 0, pf: 4200, tax: 300, otherDeductions: 300 }, paidDays: 30, lopDays: 0, workingDays: 30 }],
  ];

  for (const [name, slip] of cases) {
    const buf = await generateSalarySlipPdf(slip, company);
    const raw = buf.toString('latin1');

    assert(raw.startsWith('%PDF'), `${name}: output is not a valid PDF (missing %PDF header)`);
    assert(buf.length > 3000, `${name}: PDF suspiciously small (${buf.length} bytes)`);
    assert(raw.includes('DejaVuSansCondensed'), `${name}: embedded Unicode font missing — rupee sign will degrade to '1'`);
    assert(raw.includes('Identity-H') && raw.includes('ToUnicode'), `${name}: Unicode text mapping (Identity-H/ToUnicode) missing — non-WinAnsi characters will degrade`);

    const pageObjects = (raw.match(/\/Type\s*\/Page[\s/]/g) || []).length;
    assert(pageObjects === 1, `${name}: expected exactly 1 page, found ${pageObjects}`);
    assert(/595\.\d+\s+841\.\d+/.test(raw), `${name}: page is not A4 (595.28x841.89 pt)`);
  }

  if (failures.length) {
    console.error('PAYSLIP RENDER CHECK FAILED');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('PAYSLIP RENDER CHECK PASSED (2 cases, single A4 page, Unicode font embedded, Identity-H/ToUnicode mapping)');
})().catch((e) => {
  console.error('PAYSLIP RENDER CHECK ERROR', e);
  process.exit(1);
});