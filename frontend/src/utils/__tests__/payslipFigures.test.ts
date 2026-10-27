import { describe, it, expect } from 'vitest'
import { resolvePayslipFigures } from '../payslipFigures'
import type { SalarySlip } from '../../types/user'

// Shapes taken from the two payroll writers:
//  - the AWS backend stores gross + breakdown.basic + a `payroll` day snapshot
//  - the client-side fallback run stores basicSalary/allowances/deductions
// Neither vocabulary alone produced a payslip whose arithmetic held.

const base = {
  id: 'nDIUOZU5Yg5KVNjBqQHg',
  userId: 'u1',
  employeeName: 'Test Employee',
  employeeEmail: 'test.employee@hrmax.in',
  avatar: '',
  employeeId: 'e1',
  department: '',
  departmentColor: '',
  designation: 'QA Test Engineer',
  month: 'October',
  year: 2026,
  basicSalary: 0,
  allowances: 0,
  deductions: 0,
  netSalary: 0,
  status: 'Emailed' as const,
  paidOn: null,
  companyId: 'c1',
}

const asSlip = (o: Partial<SalarySlip>) => ({ ...base, ...o }) as SalarySlip

describe('resolvePayslipFigures - backend payroll record', () => {
  // The exact October 2026 slip the app renders for Test Employee.
  const slip = asSlip({
    grossSalary: 60000,
    netSalary: 11538.46,
    breakdown: { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0, basic: 60000, absentDeduction: 48461.54, overtimePay: 0 } as any,
    payroll: { workingDays: 22, presentDays: 1, paidLeaveDays: 0, unpaidLeaveDays: 0, holidayDays: 0, absentDays: 21, overtimeHours: 0, totalPayableDays: 1 } as any,
    createdAt: new Date('2026-10-26T06:29:39.618Z'),
  })

  it('reads the payroll run instead of falling back to zeros', () => {
    const f = resolvePayslipFigures(slip)
    expect(f.basic).toBe(60000)
    expect(f.gross).toBe(60000)
    expect(f.deductions).toBe(48461.54)
    expect(f.net).toBe(11538.46)
  })

  it('satisfies Gross - Deductions = Net', () => {
    const f = resolvePayslipFigures(slip)
    expect(Math.round((f.gross - f.deductions) * 100) / 100).toBe(f.net)
    const rowSum = Math.round(f.deductionRows.reduce((s, r) => s + r[1], 0) * 100) / 100
    expect(rowSum).toBe(f.deductions)
  })

  it('takes day counts from the payroll snapshot, not the 30/0 defaults', () => {
    const f = resolvePayslipFigures(slip)
    expect(f.workingDays).toBe(22)
    expect(f.paidDays).toBe(1)
    expect(f.lopDays).toBe(21)
    expect(f.paidDays + f.lopDays).toBe(f.workingDays)
  })

  it('falls back to the issue stamp when no pay date is stored', () => {
    const f = resolvePayslipFigures(slip)
    expect(f.issuedOn?.toISOString()).toBe('2026-10-26T06:29:39.618Z')
  })
})

describe('resolvePayslipFigures - client-side payroll record', () => {
  // `otherDeductions` folds in the absent cut that is ALSO stored separately.
  const slip = asSlip({
    basicSalary: 24000,
    allowances: 36000,
    deductions: 5000,
    netSalary: 55000,
    grossSalary: 60000,
    breakdown: { hra: 12000, da: 6000, pf: 0, tax: 0, otherDeductions: 5000, absentDeduction: 5000 } as any,
    payroll: { workingDays: 26, presentDays: 20, totalPayableDays: 20, absentDays: 6, unpaidLeaveDays: 0 } as any,
  })

  it('does not count the absent cut twice', () => {
    const f = resolvePayslipFigures(slip)
    expect(f.gross).toBe(60000)
    expect(f.deductions).toBe(5000)
    expect(Math.round((f.gross - f.deductions) * 100) / 100).toBe(f.net)
    expect(f.deductionRows.filter((r) => r[1] > 0)).toHaveLength(1)
  })
})

describe('resolvePayslipFigures - overtime is earned once', () => {
  const slip = asSlip({
    grossSalary: 60000,
    netSalary: 62000,
    breakdown: { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0, basic: 60000, overtimePay: 2000, absentDeduction: 0 } as any,
    payroll: { workingDays: 26, presentDays: 26, totalPayableDays: 26, absentDays: 0, overtimeHours: 10 } as any,
  })

  it('shows overtime as its own earning without inflating gross twice', () => {
    const f = resolvePayslipFigures(slip)
    expect(f.gross).toBe(62000)
    expect(f.deductionRows).toHaveLength(0)
    expect(f.deductions).toBe(0)
  })
})

describe('resolvePayslipFigures - records without a payroll snapshot', () => {
  it('keeps the stored totals for a hand-made slip', () => {
    const f = resolvePayslipFigures(asSlip({
      basicSalary: 0,
      allowances: 0,
      deductions: 46461.34,
      netSalary: 11538.46,
      breakdown: { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 46461.34 } as any,
    }))
    expect(f.workingDays).toBe(30)
    expect(f.paidDays).toBe(30)
    expect(f.lopDays).toBe(0)
    expect(f.deductions).toBe(46461.34)
  })
})
