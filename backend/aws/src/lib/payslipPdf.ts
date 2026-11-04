/**
 * Payslip PDF generator — EMAIL-ATTACHMENT PATH.
 *
 * SPEC §D (PDF parity): the PDF attached to a payslip email must be identical
 * in layout, styling and ₹ (UTF-8) rendering to the PDF the browser offers as
 * a direct download. This module is therefore an exact twin of
 * `frontend/src/utils/payslipPdf.ts` — same mm A4 canvas, same section order,
 * same colours, same DejaVu Sans Condensed fonts, same shrink-to-fit money
 * drawing. Keep the two files in step: a layout change here MUST be mirrored
 * there (and vice versa).
 *
 * The figure resolver mirrors `frontend/src/utils/payslipFigures.ts` for the
 * same reason (both the HTML template and the PDFs read the stored slip
 * through the same rules — never one vocabulary only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF, GState } from 'jspdf';

export interface PayslipPdfInput {
  companyName?: string;
  companyAddress?: string;
  employeeName: string;
  employeeId?: string;
  designation?: string;
  employeeEmail?: string;
  month: string;
  year: number;
  netSalary: number;
  grossSalary?: number;
  /** Legacy slip vocabulary (pre-run records). */
  basicSalary?: number;
  allowances?: number;
  deductions?: number;
  /** Real joining date — printed as "Date of Joining" (web parity). */
  dateOfJoining?: string | Date | null;
  /** Issue/pay date — printed as "Pay Date" (web parity). */
  payDate?: string | Date | null;
  breakdown?: {
    basic?: number;
    hra?: number;
    da?: number;
    overtimePay?: number;
    pf?: number;
    tax?: number;
    otherDeductions?: number;
    absentDeduction?: number;
    unpaidDeduction?: number;
    leaveEncashment?: number;
  };
  payroll?: {
    workingDays?: number;
    presentDays?: number;
    paidLeaveDays?: number;
    unpaidLeaveDays?: number;
    holidayDays?: number;
    absentDays?: number;
    overtimeHours?: number;
    totalPayableDays?: number;
    grossSalary?: number;
  };
}

// ---------------------------------------------------------------------------
// Fonts (bundled TTFs → jsPDF VFS, base64)
// ---------------------------------------------------------------------------

const FONT_DIR_CANDIDATES = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    // compiled: <root>/dist/lib → <root>/src/assets/fonts
    path.join(here, '..', '..', 'src', 'assets', 'fonts'),
    path.join(process.cwd(), 'src', 'assets', 'fonts'),
    path.join(process.cwd(), 'assets', 'fonts'),
  ];
})();

const fontCache = new Map<string, string>();

/** Read a bundled TTF as base64 (cached — jsPDF wants base64 for addFileToVFS). */
function fontBase64(file: string): string {
  const cached = fontCache.get(file);
  if (cached) return cached;
  for (const dir of FONT_DIR_CANDIDATES) {
    const full = path.join(dir, file);
    if (fs.existsSync(full)) {
      const b64 = fs.readFileSync(full).toString('base64');
      fontCache.set(file, b64);
      return b64;
    }
  }
  throw new Error(`payslip font not found: ${file}`);
}

function ensureFonts(doc: jsPDF): void {
  doc.addFileToVFS('DejaVuSansCondensed.ttf', fontBase64('DejaVuSansCondensed.ttf'));
  doc.addFont('DejaVuSansCondensed.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSansCondensed-Bold.ttf', fontBase64('DejaVuSansCondensed-Bold.ttf'));
  doc.addFont('DejaVuSansCondensed-Bold.ttf', 'DejaVu', 'bold');
}

// ---------------------------------------------------------------------------
// ₹ with Indian digit grouping and 2 decimals (kept byte-identical — the
// contract tests pin these exact outputs).
// ---------------------------------------------------------------------------

export function formatInr(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const fixed = Math.abs(n).toFixed(2);
  const [whole, frac] = fixed.split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${n < 0 ? '-' : ''}₹${grouped}.${frac}`;
}

// ---------------------------------------------------------------------------
// Figure resolver (mirror of frontend/src/utils/payslipFigures.ts)
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Figures {
  basic: number;
  hra: number;
  da: number;
  allowances: number;
  fixedAllow: number;
  leaveEncashment: number;
  overtimePay: number;
  gross: number;
  deductionRows: Array<[string, number]>;
  deductions: number;
  net: number;
  workingDays: number;
  paidDays: number;
  lopDays: number;
}

function balanceDeductionRows(rows: Array<[string, number]>, target: number): void {
  if (!(target > 0)) {
    rows.length = 0;
    return;
  }
  if (rows.length === 0) {
    rows.push(['Other Deductions', target]);
    return;
  }
  for (let guard = 0; guard < 8; guard++) {
    const sum = round2(rows.reduce((s, r) => s + r[1], 0));
    const diff = round2(target - sum);
    if (Math.abs(diff) < 0.005) return;
    if (diff > 0) {
      const existing = rows.find((r) => r[0] === 'Other Deductions' || r[0] === 'Additional Deductions');
      if (existing) existing[1] = round2(existing[1] + diff);
      else rows.push(['Other Deductions', diff]);
      return;
    }
    let idx = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i][1] > rows[idx][1]) idx = i;
    const next = round2(rows[idx][1] + diff);
    if (next > 0) {
      rows[idx][1] = next;
      return;
    }
    rows.splice(idx, 1);
    if (rows.length === 0) {
      rows.push(['Other Deductions', target]);
      return;
    }
  }
}

function resolveFigures(input: PayslipPdfInput): Figures {
  const bd = input.breakdown ?? {};
  const snap = input.payroll;
  const storedGross = num(input.grossSalary) || num(snap?.grossSalary);

  const basic = num(input.basicSalary) || num(bd.basic) || storedGross;
  const hra = num(bd.hra);
  const da = num(bd.da);
  const tax = num(bd.tax);
  const pf = num(bd.pf);
  const otherDed = num(bd.otherDeductions);
  const absentDeduction = num(bd.absentDeduction);
  const unpaidDeduction = num(bd.unpaidDeduction);
  const leaveEncashment = num(bd.leaveEncashment);
  const overtimePay = num(bd.overtimePay);

  const allowances =
    input.allowances !== undefined && input.allowances !== null && num(input.allowances) > 0
      ? num(input.allowances)
      : Math.max(0, storedGross - basic - leaveEncashment - overtimePay);

  const gross = round2(basic + allowances + leaveEncashment + overtimePay);
  const net = num(input.netSalary);

  const rows: Array<[string, number]> = [];
  if (basic > 0) rows.push(['Basic', basic]);
  if (hra > 0) rows.push(['House Rent Allowance', hra]);
  const fixedAllow = Math.max(0, allowances - hra - da);
  if (fixedAllow > 0) rows.push(['Fixed Allowance', fixedAllow]);
  if (leaveEncashment > 0) rows.push(['Leave Encashment', leaveEncashment]);
  if (overtimePay > 0) rows.push(['Overtime Pay', overtimePay]);
  if (rows.length === 0 && gross > 0) rows.push(['Earnings', gross]);

  const otherComponent = Math.max(0, otherDed - absentDeduction - unpaidDeduction);

  const deductionRows: Array<[string, number]> = [];
  if (pf > 0) deductionRows.push(['Provident Fund', pf]);
  if (tax > 0) deductionRows.push(['Professional Tax', tax]);
  if (absentDeduction > 0) deductionRows.push(['Absent Deduction', absentDeduction]);
  if (unpaidDeduction > 0) deductionRows.push(['Unpaid Leave Deduction', unpaidDeduction]);
  if (otherComponent > 0) deductionRows.push(['Other Deductions', otherComponent]);

  const implied = gross > 0 ? round2(Math.max(0, gross - net)) : 0;
  const storedTotal = num(input.deductions);
  const target = gross > 0 ? implied : storedTotal || round2(deductionRows.reduce((s, r) => s + r[1], 0));
  balanceDeductionRows(deductionRows, target);

  const deductions = round2(deductionRows.reduce((s, r) => s + r[1], 0));

  const topWorking = num((input as unknown as Record<string, unknown>).workingDays);
  const topPaid = num((input as unknown as Record<string, unknown>).paidDays);
  const topLop = num((input as unknown as Record<string, unknown>).lopDays);
  const workingDays = topWorking || num(snap?.workingDays) || 30;
  const snapLop = snap ? Math.max(0, num(snap.absentDays) + num(snap.unpaidLeaveDays)) : 0;
  const snapPaid = snap ? num(snap.totalPayableDays) || num(snap.presentDays) : 0;
  const lopDays = snap ? snapLop : topLop;
  const paidDays = snap
    ? snapPaid || Math.max(0, workingDays - snapLop)
    : topPaid || Math.max(0, workingDays - topLop);

  return {
    basic: round2(basic),
    hra,
    da,
    allowances: round2(allowances),
    fixedAllow: round2(fixedAllow),
    leaveEncashment,
    overtimePay,
    gross,
    deductionRows,
    deductions,
    net: round2(net),
    workingDays,
    paidDays: round2(paidDays),
    lopDays: round2(lopDays),
  };
}

// ---------------------------------------------------------------------------
// Drawing helpers (identical to the web download)
// ---------------------------------------------------------------------------

const C = {
  white: [255, 255, 255] as [number, number, number],
  primary: [249, 115, 22] as [number, number, number],
  primaryDark: [234, 88, 12] as [number, number, number],
  primaryLight: [255, 247, 237] as [number, number, number],
  primaryBorder: [253, 186, 116] as [number, number, number],
  border: [214, 214, 214] as [number, number, number],
  borderStrong: [191, 197, 204] as [number, number, number],
  headerText: [17, 24, 39] as [number, number, number],
  bodyText: [55, 65, 81] as [number, number, number],
  mutedText: [107, 114, 128] as [number, number, number],
  footerText: [156, 163, 175] as [number, number, number],
  rowAlt: [252, 252, 252] as [number, number, number],
};

const PAGE_MARGIN = 14;
const ROW_HEIGHT = 10.6;
const HEADER_HEIGHT = 11.1;
const NET_ROW_HEIGHT = 11;
const SECTION_GAP = 12;

const fmtMoney = (n: number) => {
  const f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `\u20B9 ${f.format(n || 0)}`;
};

const numberToWords = (num_: number): string => {
  if (num_ === 0) return `Indian Rupees Zero Only`;
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const convert = (n: number): string => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  };
  const rupees = Math.floor(num_);
  const paise = Math.round((num_ - rupees) * 100);
  let result = `Indian Rupees ${convert(rupees)}`;
  if (paise > 0) result += ` and ${convert(paise)} Paise`;
  return result + ' Only';
};

const safeDate = (value: unknown): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
};

const formatDate = (value: unknown): string => {
  const d = safeDate(value);
  if (!d) return '\u2014';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function generatePayslipPdf(input: PayslipPdfInput): Buffer {
  const f = resolveFigures(input);
  const basic = f.basic;
  const hra = f.hra;
  const allowances = f.allowances;
  const deductions = f.deductions;
  const net = f.net;
  const gross = f.gross;
  const fixedAllow = f.fixedAllow;

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const payPeriod = input.month || '';
  const payYear = input.year;
  const payDateStr = formatDate(input.payDate);
  const doj = formatDate(input.dateOfJoining);
  const payPeriodStr = `${payPeriod} ${payYear}`;
  const workingDays = f.workingDays;
  const lopDays = f.lopDays;
  const paidDays = f.paidDays;
  const designation = input.designation || '\u2014';

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  ensureFonts(doc);
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const mg = PAGE_MARGIN;
  const cw = pw - mg * 2;

  let y = mg;

  const setFont = (size: number, weight: 'normal' | 'bold' = 'normal', color: [number, number, number] = C.bodyText) => {
    doc.setFontSize(size);
    doc.setFont('DejaVu', weight);
    doc.setTextColor(...color);
  };

  const truncate = (text: string, maxWidth: number): string => {
    let t = text;
    while (doc.getTextWidth(t) > maxWidth && t.length > 1) t = t.slice(0, -1);
    if (t !== text && t.length > 3) t = t.slice(0, -3) + '...';
    return t;
  };

  /** Money is never truncated: shrink the type to fit instead of cutting digits. */
  const drawAmount = (text: string, rightX: number, baseline: number, maxWidth: number, size: number) => {
    let s = size;
    doc.setFontSize(s);
    while (s > 5.5 && doc.getTextWidth(text) > maxWidth) {
      s -= 0.5;
      doc.setFontSize(s);
    }
    doc.text(text, rightX, baseline, { align: 'right' });
    doc.setFontSize(size);
  };

  // Header right: HRMAX brand — measured first so the company name on the
  // left can never run underneath it.
  const brandSub = 'Payroll Management System';
  setFont(7, 'normal', C.mutedText);
  const brandReserve = doc.getTextWidth(brandSub) + 6;

  const nameX = mg;
  const nameW = pw - mg - brandReserve - nameX;
  setFont(20, 'bold', C.headerText);
  doc.text(truncate(input.companyName || 'Company', nameW), nameX, y + 14);
  const addressLine = input.companyAddress || '';
  if (addressLine) {
    setFont(8, 'normal', C.bodyText);
    doc.text(truncate(addressLine, nameW), nameX, y + 18);
  }

  setFont(15, 'bold', C.primary);
  doc.text('HRMAX', pw - mg, y + 5, { align: 'right' });
  setFont(7, 'normal', C.mutedText);
  doc.text(brandSub, pw - mg, y + 9, { align: 'right' });
  y += 24;

  // Orange divider
  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.7);
  doc.line(mg, y, pw - mg, y);
  y += SECTION_GAP;

  // Title
  setFont(17, 'bold', C.headerText);
  doc.text(`Payslip for the month of ${payPeriod} ${payYear}`, mg, y);
  y += 4;
  doc.setFillColor(...C.primary);
  doc.rect(mg, y, 26.4, 0.8, 'F');
  y += SECTION_GAP - 2;

  // Employee Pay Summary
  setFont(11, 'bold', C.primaryDark);
  doc.text('EMPLOYEE PAY SUMMARY', mg, y);
  y += 5;

  const leftFields: Array<[string, string]> = [
    ['Employee Name', input.employeeName || '\u2014'],
    ['Designation', designation],
    ['Date of Joining', doj],
    ['Pay Period', payPeriodStr],
    ['Pay Date', payDateStr],
  ];
  const leftContentH = leftFields.length * 5.8 + 4;
  // Right column carries label + big amount + TWO day lines: 30mm pushed the
  // LOP baseline past the rounded box border, so the box is sized for the
  // taller side (40mm).
  const rightContentH = 40;
  const summaryH = Math.max(leftContentH, rightContentH);
  const summaryY = y;

  // Summary box border
  doc.setDrawColor(...C.primaryBorder);
  doc.setLineWidth(0.5);
  doc.roundedRect(mg, summaryY, cw, summaryH, 1.5, 1.5, 'S');
  doc.setFillColor(...C.primaryLight);
  doc.setGState(new GState({ opacity: 0.15 }));
  doc.rect(mg, summaryY, cw, summaryH, 'F');
  doc.setGState(new GState({ opacity: 1 }));

  // Left fields
  setFont(8, 'normal', C.mutedText);
  let ly = summaryY + (summaryH - leftContentH) / 2 + 4;
  leftFields.forEach(([label, value]) => {
    doc.text(label, mg + 5, ly);
    setFont(8, 'normal', C.bodyText);
    doc.text(':', mg + 35, ly);
    doc.text(truncate(value, cw * 0.26), mg + 39, ly);
    setFont(8, 'normal', C.mutedText);
    ly += 5.8;
  });

  // Net pay right side
  const rightX = mg + cw * 0.55;
  const dividerTop = summaryY + 8;
  const dividerBottom = summaryY + summaryH - 8;
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.25);
  doc.line(rightX - 7, dividerTop, rightX - 7, dividerBottom);

  setFont(8, 'bold', C.mutedText);
  doc.text('EMPLOYEE NET PAY', rightX, summaryY + 12);

  const netStr = fmtMoney(net);
  let netFontSize = 18;
  const maxNetWidth = cw * 0.40;
  while (netFontSize > 11) {
    doc.setFontSize(netFontSize);
    if (doc.getTextWidth(netStr) <= maxNetWidth) break;
    netFontSize -= 1;
  }
  doc.setFont('DejaVu', 'bold');
  doc.setTextColor(...C.primaryDark);
  doc.text(netStr, pw - mg - 2, summaryY + 21, { align: 'right' });

  setFont(9, 'normal', C.bodyText);
  doc.setTextColor(...C.bodyText);
  doc.text(`Paid Days : ${paidDays}`, rightX, summaryY + 31);
  doc.text(`LOP Days : ${lopDays}`, rightX, summaryY + 36.5);

  y = summaryY + summaryH + SECTION_GAP;

  // Earnings
  const earnings: Array<[string, number]> = [];
  if (basic > 0) earnings.push(['Basic', basic]);
  if (hra > 0) earnings.push(['House Rent Allowance', hra]);
  if (fixedAllow > 0) earnings.push(['Fixed Allowance', fixedAllow]);
  if (f.leaveEncashment > 0) earnings.push(['Leave Encashment', f.leaveEncashment]);
  if (f.overtimePay > 0) earnings.push(['Overtime Pay', f.overtimePay]);
  if (earnings.length === 0 && gross > 0) earnings.push(['Earnings', gross]);

  const deductionsList = f.deductionRows;
  const hasDeductions = deductionsList.length > 0;

  setFont(11, 'bold', C.primaryDark);
  doc.text('EARNINGS', mg, y);
  y += 5;

  if (hasDeductions) {
    const colWidths = [cw * 0.25, cw * 0.125, cw * 0.125, cw * 0.25, cw * 0.125, cw * 0.125];
    const rowCount = Math.max(earnings.length, deductionsList.length) + 1;
    const tableH = HEADER_HEIGHT + rowCount * ROW_HEIGHT;

    // Header
    doc.setFillColor(...C.primaryLight);
    doc.rect(mg, y, cw, HEADER_HEIGHT, 'F');
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.25);
    doc.rect(mg, y, cw, HEADER_HEIGHT, 'S');
    doc.setDrawColor(...C.borderStrong);
    doc.setLineWidth(0.4);
    doc.line(mg, y + HEADER_HEIGHT, mg + cw, y + HEADER_HEIGHT);
    setFont(8, 'bold', C.primaryDark);
    const headers = ['Earnings', 'Amount', 'YTD', 'Deductions', 'Amount', 'YTD'];
    let hx = mg;
    headers.forEach((h, i) => {
      const align = i === 0 || i === 3 ? 'left' : 'right';
      const x = align === 'left' ? hx + 3 : hx + colWidths[i] - 3;
      doc.text(h, x, y + HEADER_HEIGHT / 2 + 1, { align });
      hx += colWidths[i];
    });

    // Rows
    const maxDataRows = rowCount - 1;
    for (let i = 0; i < maxDataRows; i++) {
      const ry = y + HEADER_HEIGHT + i * ROW_HEIGHT;
      doc.setFillColor(...(i % 2 === 0 ? C.white : C.rowAlt));
      doc.rect(mg, ry, cw, ROW_HEIGHT, 'F');
      doc.setDrawColor(...C.border);
      doc.setLineWidth(0.15);
      doc.line(mg, ry + ROW_HEIGHT, mg + cw, ry + ROW_HEIGHT);
      let vx = mg;
      for (let j = 0; j < 5; j++) {
        vx += colWidths[j];
        doc.line(vx, ry, vx, ry + ROW_HEIGHT);
      }
      setFont(7.5, 'normal', C.bodyText);
      if (earnings[i]) {
        doc.text(truncate(earnings[i][0], colWidths[0] - 8), mg + 3, ry + ROW_HEIGHT / 2 + 1);
        const earnAmt = fmtMoney(earnings[i][1]);
        drawAmount(earnAmt, mg + colWidths[0] + colWidths[1] - 3, ry + ROW_HEIGHT / 2 + 1, colWidths[1] - 5, 7.5);
        drawAmount(earnAmt, mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, ry + ROW_HEIGHT / 2 + 1, colWidths[2] - 5, 7.5);
      }
      if (deductionsList[i]) {
        const dx = mg + colWidths[0] + colWidths[1] + colWidths[2];
        doc.text(truncate(deductionsList[i][0], colWidths[3] - 8), dx + 3, ry + ROW_HEIGHT / 2 + 1);
        const dedAmt = fmtMoney(deductionsList[i][1]);
        drawAmount(dedAmt, dx + colWidths[3] + colWidths[4] - 3, ry + ROW_HEIGHT / 2 + 1, colWidths[4] - 5, 7.5);
        drawAmount(dedAmt, dx + colWidths[3] + colWidths[4] + colWidths[5] - 3, ry + ROW_HEIGHT / 2 + 1, colWidths[5] - 5, 7.5);
      }
    }

    // Total row
    const totalY = y + HEADER_HEIGHT + maxDataRows * ROW_HEIGHT;
    doc.setFillColor(...C.primaryLight);
    doc.rect(mg, totalY, cw, ROW_HEIGHT, 'F');
    doc.setDrawColor(...C.primary);
    doc.setLineWidth(0.5);
    doc.line(mg, totalY, mg + cw, totalY);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.25);
    doc.line(mg, totalY + ROW_HEIGHT, mg + cw, totalY + ROW_HEIGHT);
    let tvx = mg;
    for (let j = 0; j < 5; j++) {
      tvx += colWidths[j];
      doc.line(tvx, totalY, tvx, totalY + ROW_HEIGHT);
    }
    setFont(10, 'bold', C.headerText);
    doc.text('Gross Earnings', mg + 3, totalY + ROW_HEIGHT / 2 + 1.2);
    const grossAmt = fmtMoney(gross);
    drawAmount(grossAmt, mg + colWidths[0] + colWidths[1] - 3, totalY + ROW_HEIGHT / 2 + 1.2, colWidths[1] - 5, 10);
    drawAmount(grossAmt, mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, totalY + ROW_HEIGHT / 2 + 1.2, colWidths[2] - 5, 10);
    const tdx = mg + colWidths[0] + colWidths[1] + colWidths[2];
    doc.text('Total Deductions', tdx + 3, totalY + ROW_HEIGHT / 2 + 1.2);
    const dedAmt = fmtMoney(deductions);
    drawAmount(dedAmt, tdx + colWidths[3] + colWidths[4] - 3, totalY + ROW_HEIGHT / 2 + 1.2, colWidths[4] - 5, 10);
    drawAmount(dedAmt, tdx + colWidths[3] + colWidths[4] + colWidths[5] - 3, totalY + ROW_HEIGHT / 2 + 1.2, colWidths[5] - 5, 10);

    // Outer border
    doc.setDrawColor(...C.borderStrong);
    doc.setLineWidth(0.4);
    doc.rect(mg, y, cw, tableH, 'S');
    y += tableH + SECTION_GAP;
  } else {
    // Earnings-only table
    const colWidths = [cw * 0.40, cw * 0.30, cw * 0.30];
    const rowCount = earnings.length + 1;
    const tableW = cw * 0.70;
    const tableH = HEADER_HEIGHT + rowCount * ROW_HEIGHT;

    doc.setFillColor(...C.primaryLight);
    doc.rect(mg, y, tableW, HEADER_HEIGHT, 'F');
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.25);
    doc.rect(mg, y, tableW, HEADER_HEIGHT, 'S');
    doc.setDrawColor(...C.borderStrong);
    doc.setLineWidth(0.4);
    doc.line(mg, y + HEADER_HEIGHT, mg + tableW, y + HEADER_HEIGHT);
    setFont(8, 'bold', C.primaryDark);
    doc.text('Earnings', mg + 3, y + HEADER_HEIGHT / 2 + 1);
    doc.text('Amount', mg + colWidths[0] + colWidths[1] - 3, y + HEADER_HEIGHT / 2 + 1, { align: 'right' });
    doc.text('YTD', mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, y + HEADER_HEIGHT / 2 + 1, { align: 'right' });

    for (let i = 0; i < earnings.length; i++) {
      const ry = y + HEADER_HEIGHT + i * ROW_HEIGHT;
      doc.setFillColor(...(i % 2 === 0 ? C.white : C.rowAlt));
      doc.rect(mg, ry, tableW, ROW_HEIGHT, 'F');
      doc.setDrawColor(...C.border);
      doc.setLineWidth(0.15);
      doc.line(mg, ry + ROW_HEIGHT, mg + tableW, ry + ROW_HEIGHT);
      doc.line(mg + colWidths[0], ry, mg + colWidths[0], ry + ROW_HEIGHT);
      doc.line(mg + colWidths[0] + colWidths[1], ry, mg + colWidths[0] + colWidths[1], ry + ROW_HEIGHT);
      setFont(7.5, 'normal', C.bodyText);
      doc.text(truncate(earnings[i][0], colWidths[0] - 8), mg + 3, ry + ROW_HEIGHT / 2 + 1);
      const earnAmt = fmtMoney(earnings[i][1]);
      drawAmount(earnAmt, mg + colWidths[0] + colWidths[1] - 3, ry + ROW_HEIGHT / 2 + 1, colWidths[1] - 5, 7.5);
      drawAmount(earnAmt, mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, ry + ROW_HEIGHT / 2 + 1, colWidths[2] - 5, 7.5);
    }

    const totalY = y + HEADER_HEIGHT + earnings.length * ROW_HEIGHT;
    doc.setFillColor(...C.primaryLight);
    doc.rect(mg, totalY, tableW, ROW_HEIGHT, 'F');
    doc.setDrawColor(...C.primary);
    doc.setLineWidth(0.5);
    doc.line(mg, totalY, mg + tableW, totalY);
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.25);
    doc.line(mg, totalY + ROW_HEIGHT, mg + tableW, totalY + ROW_HEIGHT);
    doc.line(mg + colWidths[0], totalY, mg + colWidths[0], totalY + ROW_HEIGHT);
    doc.line(mg + colWidths[0] + colWidths[1], totalY, mg + colWidths[0] + colWidths[1], totalY + ROW_HEIGHT);
    setFont(10, 'bold', C.headerText);
    doc.text('Gross Earnings', mg + 3, totalY + ROW_HEIGHT / 2 + 1.2);
    const grossAmt = fmtMoney(gross);
    drawAmount(grossAmt, mg + colWidths[0] + colWidths[1] - 3, totalY + ROW_HEIGHT / 2 + 1.2, colWidths[1] - 5, 10);
    drawAmount(grossAmt, mg + colWidths[0] + colWidths[1] + colWidths[2] - 3, totalY + ROW_HEIGHT / 2 + 1.2, colWidths[2] - 5, 10);

    doc.setDrawColor(...C.borderStrong);
    doc.setLineWidth(0.4);
    doc.rect(mg, y, tableW, tableH, 'S');
    y += tableH + SECTION_GAP;
  }

  // Net Pay Summary
  setFont(11, 'bold', C.primaryDark);
  doc.text('NET PAY', mg, y);
  y += 5;

  const netRows: Array<[string, number]> = [
    ['Gross Earnings', gross],
    ['Total Deductions', deductions],
    ['Total Net Payable', net],
  ];
  const netH = netRows.length * NET_ROW_HEIGHT;

  doc.setDrawColor(...C.borderStrong);
  doc.setLineWidth(0.4);
  doc.rect(mg, y, cw, netH, 'S');
  doc.setDrawColor(...C.border);
  doc.setLineWidth(0.15);
  doc.line(mg, y + NET_ROW_HEIGHT, mg + cw, y + NET_ROW_HEIGHT);
  doc.line(mg, y + NET_ROW_HEIGHT * 2, mg + cw, y + NET_ROW_HEIGHT * 2);

  netRows.forEach(([label, amount], i) => {
    const ry = y + i * NET_ROW_HEIGHT + NET_ROW_HEIGHT / 2 + 1.5;
    const isTotal = i === netRows.length - 1;
    if (isTotal) {
      doc.setFillColor(...C.primaryLight);
      doc.rect(mg, y + i * NET_ROW_HEIGHT, cw, NET_ROW_HEIGHT, 'F');
      doc.setDrawColor(...C.primary);
      doc.setLineWidth(0.5);
      doc.line(mg, y + i * NET_ROW_HEIGHT, mg + cw, y + i * NET_ROW_HEIGHT);
    }
    setFont(isTotal ? 12 : 9.5, isTotal ? 'bold' : 'normal', isTotal ? C.headerText : C.bodyText);
    doc.text(label, mg + 4, ry);
    doc.text(fmtMoney(amount), pw - mg - 4, ry, { align: 'right' });
  });

  y += netH + SECTION_GAP;

  // Amount in words
  setFont(10, 'bold', C.headerText);
  const wordsLine = `Total Net Payable `;
  const amountStr = fmtMoney(net);
  const fullLine = wordsLine + amountStr;
  const fullWidth = doc.getTextWidth(fullLine);
  const centerX = pw / 2;
  doc.text(wordsLine, centerX - fullWidth / 2, y);
  doc.setTextColor(...C.primaryDark);
  doc.text(amountStr, centerX + fullWidth / 2, y, { align: 'right' });
  doc.setTextColor(...C.headerText);
  y += 4.5;
  setFont(9, 'bold', C.headerText);
  doc.text(`(${numberToWords(net)})`, pw / 2, y, { align: 'center' });
  y += 4.5;
  setFont(8, 'normal', C.mutedText);
  doc.text('Total Net Payable = Gross Earnings \u2212 Total Deductions', pw / 2, y, { align: 'center' });
  y += SECTION_GAP;

  // Footer at bottom
  const footerY = Math.max(y, ph - mg - 12);
  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.5);
  doc.line(mg, footerY, pw - mg, footerY);
  setFont(8, 'normal', C.footerText);
  doc.text('This document has been automatically generated by HRMAX Payroll System; therefore, a signature is not required.', pw / 2, footerY + 5, { align: 'center' });

  return Buffer.from(doc.output('arraybuffer'));
}
