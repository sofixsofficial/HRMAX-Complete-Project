import type { SalarySlip, SlipPayrollInfo } from '../types/user'

/**
 * One place that turns a stored salary-slip record into the numbers a payslip
 * is allowed to print.
 *
 * The payroll run writes `grossSalary`, a `breakdown` and a `payroll` day
 * snapshot, while the slip interface (and older/hand-made records) speak in
 * `basicSalary` / `allowances` / `deductions`. Reading only one vocabulary is
 * what made real payslips print Gross Earnings ₹0.00 and Paid Days 30 next to
 * a genuine net salary - the template fell back to zeros instead of the
 * payroll truth. Both the HTML template and the PDF go through this resolver
 * so the two can never drift apart (PDF parity).
 */

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Payroll-run fields the record may carry under either spelling. */
const anySlip = (slip: SalarySlip) => slip as unknown as Record<string, unknown>

export interface PayslipFigures {
  /* earnings */
  basic: number
  hra: number
  da: number
  allowances: number
  fixedAllow: number
  leaveEncashment: number
  overtimePay: number
  /** Total earnings the slip must show (gross + overtime). */
  gross: number
  /** Deduction rows: [label, amount], already balanced against gross - net. */
  deductionRows: Array<[string, number]>
  /** Footer total: always the sum of `deductionRows`. */
  deductions: number
  net: number
  /* attendance snapshot */
  workingDays: number
  paidDays: number
  lopDays: number
  /** Date the slip was issued: pay date, else the email/create stamp. */
  issuedOn: Date | null
}

export function resolvePayslipFigures(slip: SalarySlip): PayslipFigures {
  const bd = slip.breakdown || { hra: 0, da: 0, pf: 0, tax: 0, otherDeductions: 0 }
  const snap: SlipPayrollInfo | undefined = slip.payroll
  const raw = anySlip(slip)

  const storedGross = num(raw.grossSalary) || num(snap?.grossSalary)

  const basic = num(slip.basicSalary) || num(bd.basic) || storedGross
  const hra = num(bd.hra)
  const da = num(bd.da)
  const tax = num(bd.tax)
  const pf = num(bd.pf)
  const otherDed = num(bd.otherDeductions)
  const absentDeduction = num((bd as { absentDeduction?: number }).absentDeduction)
  const unpaidDeduction = num((bd as { unpaidDeduction?: number }).unpaidDeduction)
  const leaveEncashment = num((bd as { leaveEncashment?: number }).leaveEncashment)
  const overtimePay = num((bd as { overtimePay?: number }).overtimePay)

  // Explicit allowances win; otherwise what is left of the run's gross after
  // basic, encashment and overtime (0 when the run stored Basic = gross).
  const allowances =
    slip.allowances !== undefined && slip.allowances !== null && num(slip.allowances) > 0
      ? num(slip.allowances)
      : Math.max(0, storedGross - basic - leaveEncashment - overtimePay)

  const gross = round2(basic + allowances + leaveEncashment + overtimePay)
  const net = num(slip.netSalary)

  const rows: Array<[string, number]> = []
  if (basic > 0) rows.push(['Basic', basic])
  if (hra > 0) rows.push(['House Rent Allowance', hra])
  const fixedAllow = Math.max(0, allowances - hra - da)
  if (fixedAllow > 0) rows.push(['Fixed Allowance', fixedAllow])
  if (leaveEncashment > 0) rows.push(['Leave Encashment', leaveEncashment])
  if (overtimePay > 0) rows.push(['Overtime Pay', overtimePay])
  if (rows.length === 0 && gross > 0) rows.push(['Earnings', gross])

  // The client-side payroll writer folds the unpaid-leave cut and the absent
  // cut into `otherDeductions` AND stores `absentDeduction` separately, so
  // taking both at face value counts the same rupee twice.
  const otherComponent = Math.max(0, otherDed - absentDeduction - unpaidDeduction)

  const deductionRows: Array<[string, number]> = []
  if (pf > 0) deductionRows.push(['Provident Fund', pf])
  if (tax > 0) deductionRows.push(['Professional Tax', tax])
  if (absentDeduction > 0) deductionRows.push(['Absent Deduction', absentDeduction])
  if (unpaidDeduction > 0) deductionRows.push(['Unpaid Leave Deduction', unpaidDeduction])
  if (otherComponent > 0) deductionRows.push(['Other Deductions', otherComponent])

  // The table must satisfy Gross - Deductions = Net. The stored net is the
  // payroll run's answer, so the itemised lines are balanced to it: a line
  // for anything the rows missed, or a trim when they over-counted. Records
  // with no earnings at all (hand-made slips) keep their own stored total.
  const implied = gross > 0 ? round2(Math.max(0, gross - net)) : 0
  const storedTotal = num(slip.deductions)
  const target = gross > 0 ? implied : storedTotal || round2(deductionRows.reduce((s, r) => s + r[1], 0))
  balanceDeductionRows(deductionRows, target)

  const deductions = round2(deductionRows.reduce((s, r) => s + r[1], 0))

  // Day counts: the payroll snapshot is the authority (it records what the
  // month actually held); top-level fields only serve records without one.
  const topWorking = num(raw.workingDays)
  const topPaid = num(raw.paidDays)
  const topLop = num(raw.lopDays)
  const workingDays = topWorking || num(snap?.workingDays) || 30
  const snapLop = snap ? Math.max(0, num(snap.absentDays) + num(snap.unpaidLeaveDays)) : 0
  const snapPaid = snap ? num(snap.totalPayableDays) || num(snap.presentDays) : 0
  const lopDays = snap ? snapLop : topLop
  const paidDays = snap
    ? snapPaid || Math.max(0, workingDays - snapLop)
    : topPaid || Math.max(0, workingDays - topLop)

  const issuedOn =
    toDate(raw.paidOn) || toDate(raw.emailSentAt) || toDate(raw.createdAt) || null

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
    issuedOn,
  }
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Force the itemised deduction lines to add up to `target` so the printed
 * footer can never contradict Gross - Net. The remainder becomes an
 * "Other Deductions" line; an over-count is folded into the largest line
 * (that only happens on records that stored the same cut twice).
 */
function balanceDeductionRows(rows: Array<[string, number]>, target: number): void {
  if (!(target > 0)) {
    rows.length = 0
    return
  }
  if (rows.length === 0) {
    rows.push(['Other Deductions', target])
    return
  }
  for (let guard = 0; guard < 8; guard++) {
    const sum = round2(rows.reduce((s, r) => s + r[1], 0))
    const diff = round2(target - sum)
    if (Math.abs(diff) < 0.005) return
    if (diff > 0) {
      const existing = rows.find((r) => r[0] === 'Other Deductions' || r[0] === 'Additional Deductions')
      if (existing) existing[1] = round2(existing[1] + diff)
      else rows.push(['Other Deductions', diff])
      return
    }
    let idx = 0
    for (let i = 1; i < rows.length; i++) if (rows[i][1] > rows[idx][1]) idx = i
    const next = round2(rows[idx][1] + diff)
    if (next > 0) {
      rows[idx][1] = next
      return
    }
    rows.splice(idx, 1)
    if (rows.length === 0) {
      rows.push(['Other Deductions', target])
      return
    }
  }
}
