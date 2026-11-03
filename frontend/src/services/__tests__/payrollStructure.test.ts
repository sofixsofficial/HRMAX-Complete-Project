import { describe, it, expect } from 'vitest'
import { resolveStructure, calculatePayrollItems } from '../payrollService'
import type { Employee } from '../../types/user'

// Regression: the Employees form writes `monthlyGrossSalary`; no form writes
// the legacy `salary` field. resolveStructure used to read only `employee.salary`,
// so every structure-less payroll run calculated gross/net = ₹0 (web + mobile).
const emp = (over: Partial<Employee> = {}): Employee =>
  ({ id: 'e1', userId: 'u1', employeeId: 'EMP1', name: 'Test User', email: 't@example.com', status: 'Active', companyId: 'c1', ...over }) as Employee

const structure = (over: Record<string, number> = {}) => ({
  id: 'st1',
  basicSalary: 24000, hra: 12000, da: 6000, conveyance: 6000, medical: 3000,
  specialAllowance: 9000, grossSalary: 60000, pf: 1800, professionalTax: 200,
  overtimeRate: 250, ...over,
}) as any

describe('resolveStructure salary fallback (monthlyGrossSalary vs legacy salary)', () => {
  it('uses monthlyGrossSalary when no structure exists', () => {
    expect(resolveStructure(emp({ monthlyGrossSalary: 50000 }), []).grossSalary).toBe(50000)
  })

  it('falls back to legacy salary only when monthlyGrossSalary is absent', () => {
    expect(resolveStructure(emp({ salary: 40000 }), []).grossSalary).toBe(40000)
  })

  it('prefers monthlyGrossSalary (the form-managed field) over legacy salary', () => {
    expect(resolveStructure(emp({ monthlyGrossSalary: 50000, salary: 40000 }), []).grossSalary).toBe(50000)
  })

  it('returns 0 when nothing is configured', () => {
    expect(resolveStructure(emp(), []).grossSalary).toBe(0)
  })

  it('a saved salary structure wins over the employee fields', () => {
    expect(resolveStructure(emp({ salaryStructureId: 'st1', monthlyGrossSalary: 50000 }), [structure()]).grossSalary).toBe(60000)
  })
})

describe('calculatePayrollItems end-to-end (no structure, monthlyGrossSalary only)', () => {
  it('produces a non-zero net salary', () => {
    const { items } = calculatePayrollItems({
      employees: [emp({ monthlyGrossSalary: 52000 })],
      attendance: [], leaves: [], holidays: [], structures: [],
      monthIndex: 9, year: 2026,
    })
    expect(items).toHaveLength(1)
    expect(items[0].grossSalary).toBe(52000)
    expect(items[0].netSalary).toBeGreaterThan(0)
  })

  it('still honours a structure when one is attached', () => {
    const { items } = calculatePayrollItems({
      employees: [emp({ salaryStructureId: 'st1', monthlyGrossSalary: 1 })],
      attendance: [], leaves: [], holidays: [], structures: [structure()],
      monthIndex: 9, year: 2026,
    })
    expect(items[0].grossSalary).toBe(60000)
    expect(items[0].netSalary).toBeGreaterThan(0)
  })
})
