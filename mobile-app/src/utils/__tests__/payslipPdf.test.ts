/**
 * Payslip invoice PDF parity: the generated HTML must show the same
 * ₹ figures as the detail screen and the totals must reconcile
 * (gross - deductions = net). Captures the HTML passed to expo-print.
 */

import { describe, it, expect, jest } from '@jest/globals';

const mockPrintToFile = jest.fn(async (..._a: any[]): Promise<any> => ({ uri: 'file:///tmp/payslip.pdf' }));
const mockMoveAsync = jest.fn(async (..._a: any[]): Promise<any> => undefined);
const mockShareAsync = jest.fn(async (..._a: any[]): Promise<any> => undefined);

jest.mock('expo-print', () => ({ printToFileAsync: (...a: unknown[]) => mockPrintToFile(...a) }));
jest.mock('expo-sharing', () => ({ shareAsync: (...a: unknown[]) => mockShareAsync(...a), isAvailableAsync: async () => true }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  moveAsync: (...a: unknown[]) => mockMoveAsync(...a),
}));

import { generatePayslipPdf } from '../payslipPdf';
import type { SalarySlip } from '../../types/user';

/** Shape returned by the backend for the seeded October 2026 slip. */
const liveSlip = {
  id: 'nDIUOZU5Yg5KVNjBqQHg',
  userId: 'e96ea488-3081-7079-9cab-0f65071aa41c',
  employeeName: 'Test Employee',
  employeeId: 'e96ea488-3081-7079-9cab-0f65071aa41c',
  employeeEmail: 'test.employee@hrmax.in',
  department: 'QA',
  designation: 'QA Test Engineer',
  month: 'October',
  year: 2026,
  basicSalary: 60000,
  allowances: 0,
  deductions: 48461.54,
  netSalary: 11538.46,
  grossSalary: 60000,
  status: 'Emailed',
  companyId: 'AjXkEhiyBCALDOMzUgyL',
  breakdown: {
    hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0,
    absentDeduction: 48461.54, overtimePay: 0, basic: 60000,
  },
} as unknown as SalarySlip;

const capturedHtml = async (slip: SalarySlip = liveSlip) => {
  mockPrintToFile.mockClear();
  mockShareAsync.mockClear();
  await generatePayslipPdf(slip);
  expect(mockPrintToFile).toHaveBeenCalledTimes(1);
  return (mockPrintToFile.mock.calls[0][0] as { html: string }).html;
};

/** Summary rows: <tr><td>Gross Earnings</td><td class="currency">₹ 60,000.00</td></tr> */
const summaryTotals = (html: string) => {
  const rows = [...html.matchAll(/<td>(Gross Earnings|Total Deductions|Total Net Payable)<\/td><td class="currency">₹ ([\d,]+\.\d{2})<\/td>/g)];
  return Object.fromEntries(rows.map((m) => [m[1], Number(m[2].replace(/,/g, ''))]));
};

describe('payslip invoice PDF', () => {
  it('prints and shares the generated file', async () => {
    await generatePayslipPdf(liveSlip);
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    expect(String(mockShareAsync.mock.calls[0][0])).toContain('payslip-test-employee-October-2026.pdf');
  });

  it('shows the same rupee figures as the detail screen', async () => {
    const html = await capturedHtml();
    // Basic / Gross 60,000, absent deduction and net must all be itemised.
    expect(html).toContain('₹ 60,000.00');
    expect(html).toContain('Absent Deduction');
    expect(html).toContain('48,461.54');
    expect(html).toContain('11,538.46');
    expect(html).toContain('Test Employee');
    expect(html).toContain('October');
    expect(html).toContain('2026');
  });

  it('reconciles: gross earnings minus total deductions equals net payable', async () => {
    const html = await capturedHtml();
    const totals = summaryTotals(html);

    expect(totals['Gross Earnings']).toBe(60000);
    expect(totals['Total Deductions']).toBe(48461.54);
    expect(totals['Total Net Payable']).toBe(11538.46);
    expect(
      Math.round((totals['Gross Earnings'] - totals['Total Deductions']) * 100) / 100
    ).toBe(totals['Total Net Payable']);
  });

  it('counts overtime and keeps absent deduction in the totals', async () => {
    const slip = JSON.parse(JSON.stringify(liveSlip)) as SalarySlip;
    (slip as any).netSalary = 13038.46;
    (slip as any).breakdown.overtimePay = 1500;

    const html = await capturedHtml(slip);
    expect(html).toContain('Overtime Pay');
    const totals = summaryTotals(html);

    expect(totals['Gross Earnings']).toBe(61500);
    expect(totals['Total Deductions']).toBe(48461.54);
    expect(totals['Total Net Payable']).toBe(13038.46);
    expect(
      Math.round((totals['Gross Earnings'] - totals['Total Deductions']) * 100) / 100
    ).toBe(totals['Total Net Payable']);
  });
});
