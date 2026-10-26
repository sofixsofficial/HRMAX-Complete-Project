/**
 * Server-side payslip PDF (jsPDF + DejaVu Sans Condensed).
 *
 * Why this exists: the dispatch email said "Please find attached your salary
 * slip" while sending NO attachment, and the company admin only received a
 * separate summary email instead of being CC'd (spec §D requires both).
 *
 * The same Unicode font the browser uses for the UI download
 * (frontend/public/fonts/DejaVuSansCondensed*.ttf) is bundled here, so the
 * rupee sign (U+20B9), em-dash and non-ASCII names render identically in the
 * emailed PDF and in the on-screen download.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';

export interface PayslipPdfInput {
  companyName?: string;
  employeeName: string;
  employeeId?: string;
  designation?: string;
  employeeEmail?: string;
  month: string;
  year: number;
  netSalary: number;
  grossSalary?: number;
  breakdown?: {
    basic?: number;
    overtimePay?: number;
    pf?: number;
    tax?: number;
    absentDeduction?: number;
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
  };
}

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

/** ₹ with Indian digit grouping and 2 decimals (matches the web download). */
export function formatInr(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const fixed = Math.abs(n).toFixed(2);
  const [whole, frac] = fixed.split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${n < 0 ? '-' : ''}₹${grouped}.${frac}`;
}

export function generatePayslipPdf(input: PayslipPdfInput): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();

  // Unicode font — required for ₹
  doc.addFileToVFS('DejaVuSansCondensed.ttf', fontBase64('DejaVuSansCondensed.ttf'));
  doc.addFont('DejaVuSansCondensed.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSansCondensed-Bold.ttf', fontBase64('DejaVuSansCondensed-Bold.ttf'));
  doc.addFont('DejaVuSansCondensed-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');

  // ── Brand band
  doc.setFillColor(255, 102, 0);
  doc.rect(0, 0, W, 54, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(18);
  doc.text('HR MAX', 40, 34);
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(11);
  doc.text(input.companyName ? `${input.companyName}  ·  Sofixs` : 'Sofixs', W - 40, 34, { align: 'right' });

  // ── Title
  doc.setTextColor(17, 24, 39);
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(15);
  doc.text('SALARY SLIP', 40, 90);
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(107, 114, 128);
  doc.text(`${input.month} ${input.year}`, 40, 108);

  // ── Employee block
  const info: Array<[string, string]> = [
    ['Employee', input.employeeName || '-'],
    ['Employee ID', input.employeeId || '-'],
    ['Designation', input.designation || '-'],
    ['Email', input.employeeEmail || '-'],
  ];
  let y = 136;
  doc.setFontSize(10);
  for (const [label, value] of info) {
    doc.setTextColor(107, 114, 128);
    doc.text(label, 40, y);
    doc.setTextColor(17, 24, 39);
    doc.setFont('DejaVu', 'bold');
    doc.text(String(value), 150, y);
    doc.setFont('DejaVu', 'normal');
    y += 16;
  }

  // ── Attendance summary (only when the run recorded it)
  const p = input.payroll ?? {};
  if (p.workingDays !== undefined) {
    autoTable(doc, {
      startY: y + 6,
      head: [['Working Days', 'Present', 'Paid Leave', 'Unpaid Leave', 'Holidays', 'Absent']],
      body: [[
        String(p.workingDays ?? '-'),
        String(p.presentDays ?? '-'),
        String(p.paidLeaveDays ?? '-'),
        String(p.unpaidLeaveDays ?? '-'),
        String(p.holidayDays ?? '-'),
        String(p.absentDays ?? '-'),
      ]],
      styles: { font: 'DejaVu', fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [255, 102, 0], textColor: [255, 255, 255] },
      margin: { left: 40, right: 40 },
    });
  }

  // ── Earnings / deductions
  const b = input.breakdown ?? {};
  const earnings: Array<[string, number]> = [
    ['Basic', input.grossSalary ?? b.basic ?? 0],
    ['Overtime', b.overtimePay ?? 0],
  ];
  const deductions: Array<[string, number]> = [
    ['Provident Fund', b.pf ?? 0],
    ['Professional Tax', b.tax ?? 0],
    ['Absence deduction', b.absentDeduction ?? 0],
  ];

  autoTable(doc, {
    startY: ((doc as any).lastAutoTable?.finalY ?? y + 6) + 14,
    head: [['Earnings', 'Amount', 'Deductions', 'Amount']],
    body: [
      ...earnings.map(([k, v]) => [k, formatInr(v), '', ''] as [string, string, string, string]),
      ...deductions.map(([k, v], i) => {
        const earn = earnings[i];
        return [(earn ? '' : ''), '', k, formatInr(v)] as [string, string, string, string];
      }),
    ],
    styles: { font: 'DejaVu', fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
    margin: { left: 40, right: 40 },
  });

  // ── Net pay
  const finalY = ((doc as any).lastAutoTable?.finalY ?? 300) + 26;
  doc.setFillColor(16, 185, 129);
  doc.roundedRect(40, finalY, W - 80, 46, 8, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(13);
  doc.text('Net Pay', 56, finalY + 28);
  doc.setFontSize(16);
  doc.text(formatInr(input.netSalary), W - 56, finalY + 28, { align: 'right' });

  // ── Footer
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(156, 163, 175);
  doc.text(
    `Confidential — issued by HR MAX for ${input.employeeName || 'the employee'}. Generated ${new Date().toISOString().slice(0, 10)}.`,
    40,
    doc.internal.pageSize.getHeight() - 34,
  );
  doc.text('HR MAX · Sofixs', W - 40, doc.internal.pageSize.getHeight() - 34, { align: 'right' });

  return Buffer.from(doc.output('arraybuffer'));
}
