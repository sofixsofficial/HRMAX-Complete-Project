import { useEffect, useState } from 'react'
import { Loader2, CalendarRange } from 'lucide-react'
import { computeLeaveBalance, getLeaveRequestsByUser, LEAVE_TYPES, resolveEmployeeLeaveEntitlements } from '../services/leaveService'
import type { LeaveBalanceEntry } from '../services/leaveService'
import { resolveEmployeeLeavePolicy } from '../services/leavePolicyService'
import type { LeaveType } from '../services/leaveService'

interface LeaveBalanceCardProps {
  userId: string
  companyId?: string
  employeePolicyId?: string
  monthlyEntitlements?: Record<string, number>
  joinDate?: string | Date | null
}

export function LeaveBalanceCard({ userId, companyId, employeePolicyId, monthlyEntitlements, joinDate }: LeaveBalanceCardProps) {
  const [balances, setBalances] = useState<Record<string, LeaveBalanceEntry> | null>(null)
  const [encashableTypes, setEncashableTypes] = useState<LeaveType[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!userId) return
    let active = true
    const entitlements = resolveEmployeeLeaveEntitlements({ monthlyLeaveEntitlements: monthlyEntitlements })
    if (entitlements) {
      Promise.resolve(getLeaveRequestsByUser(userId))
        .then((leaves) => {
          if (!active) return
          setEncashableTypes(entitlements.config.encashable)
          setBalances(computeLeaveBalance(entitlements.yearly, leaves, userId, new Date().getFullYear(), undefined, entitlements.config, true))
        })
        .catch(() => active && setError(true))
      return () => { active = false }
    }
    Promise.all([
      getLeaveRequestsByUser(userId),
      companyId ? resolveEmployeeLeavePolicy(companyId, employeePolicyId) : Promise.resolve(null),
    ])
      .then(([leaves, resolved]) => {
        if (!active) return
        setEncashableTypes(resolved?.encashable || [])
        setBalances(computeLeaveBalance(resolved?.allowances, leaves, userId, new Date().getFullYear(), joinDate, resolved?.config))
      })
      .catch(() => active && setError(true))
    return () => { active = false }
  }, [userId, joinDate, companyId, employeePolicyId, monthlyEntitlements])

  return (
    <div className="modal-section">
      <div className="modal-section-header"><CalendarRange size={18} /><h4>Leave Balance ({new Date().getFullYear()})</h4></div>
      <div className="modal-section-content">
        {!balances && !error ? (
          <div style={{ color: '#6b7280', fontSize: 13 }}><Loader2 size={14} className="animate-spin" style={{ verticalAlign: -2, marginRight: 6 }} /> Loading leave balance...</div>
        ) : error ? (
          <div style={{ color: '#dc2626', fontSize: 13 }}>Could not load leave balance.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {LEAVE_TYPES.filter(t => t !== 'Unpaid').map(t => {
              const b = (balances as Record<string, LeaveBalanceEntry>)[t]
              if (!b) return null
              const pct = b.allowance > 0 ? Math.round((b.used / b.allowance) * 100) : 0
              const encashable = encashableTypes.includes(t)
              return (
                <div key={t} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', background: '#fafafa' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                    {t}{encashable ? ' *' : ''}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    {b.available} left · {b.used} used / {b.allowance} yearly
                    {b.monthly !== undefined && b.monthly > 0 ? ` · ${b.monthly}/mo` : ''}
                  </div>
                  {b.pending > 0 && <div style={{ fontSize: 10, color: '#6366f1', marginTop: 2 }}>+{b.pending} pending</div>}
                  <div style={{ height: 5, background: '#e5e7eb', borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: pct >= 80 ? '#ef4444' : pct >= 50 ? '#f59e0b' : '#16a34a', borderRadius: 3 }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {balances && encashableTypes.some(t => (balances as Record<string, LeaveBalanceEntry>)[t]?.available > 0) && (
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 10 }}>
            * Encashable at year-end (December payroll).
          </div>
        )}
      </div>
    </div>
  )
}