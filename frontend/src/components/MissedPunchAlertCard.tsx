import { Clock, ArrowUpRight, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface MissedPunchAlertCardProps {
  count: number
  label?: string
  path?: string
  badge?: number
}

/**
 * Prominent Missed Punch / Attendance Alert card + counter badge used on the
 * role dashboards. Tapping it routes to the filtered attendance view showing
 * only the current user's scoped missed-punch records.
 */
export function MissedPunchAlertCard({
  count,
  label = 'Missed Punch',
  path = '/attendance?status=Miss Punch',
  badge,
}: MissedPunchAlertCardProps) {
  const navigate = useNavigate()
  const hasAlerts = (badge ?? count) > 0
  const handleClick = () => navigate(path)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }

  return (
    <div
      className="miss-punch-alert-card"
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
        padding: '14px 16px', borderRadius: 12, marginBottom: 12,
        border: hasAlerts ? '1px solid #fecaca' : '1px solid #e5e7eb',
        background: hasAlerts ? 'linear-gradient(135deg,#fff1f2,#fff7ed)' : '#fff',
      }}
    >
      <div
        className="miss-punch-alert-icon"
        style={{
          width: 44, height: 44, borderRadius: 10, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: hasAlerts ? '#fee2e2' : '#f3f4f6', color: hasAlerts ? '#dc2626' : '#6b7280',
        }}
      >
        {hasAlerts ? <AlertTriangle size={24} /> : <Clock size={24} />}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: hasAlerts ? '#dc2626' : '#0f172a', lineHeight: 1.1 }}>
          {count}
          {hasAlerts && <span style={{ fontSize: 12, fontWeight: 500, color: hasAlerts ? '#dc2626' : '#64748b', marginLeft: 8 }}>needs review</span>}
        </div>
      </div>
      {hasAlerts && (
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 22, height: 22, padding: '0 7px', borderRadius: 100,
            background: '#dc2626', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}
        >
          {badge ?? count}
        </span>
      )}
      <ArrowUpRight size={18} style={{ color: hasAlerts ? '#dc2626' : '#9ca3af', flexShrink: 0 }} />
    </div>
  )
}
