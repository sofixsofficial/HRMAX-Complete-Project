import { AlertTriangle, CheckCircle, X } from 'lucide-react'

interface Props {
  /** The message to display. When null/empty the banner is hidden. */
  message: string | null | undefined
  /** 'error' (red) or 'success' (green). Defaults to 'error'. */
  type?: 'error' | 'success'
  /** Called when the dismiss (×) button is clicked. */
  onDismiss?: () => void
  /** Optional bottom margin override (px). Defaults to 16. */
  marginBottom?: number
}

/**
 * Consistent, inline, section-level feedback banner for failed (or successful)
 * actions. Replaces browser `alert()` popups so errors appear directly in the
 * relevant section with uniform styling across the app.
 *
 *   {actionError && <ActionErrorBanner message={actionError} onDismiss={() => setActionError(null)} />}
 */
export function ActionErrorBanner({ message, type = 'error', onDismiss, marginBottom = 16 }: Props) {
  if (!message) return null
  const isError = type === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 16px',
        background: isError ? '#fef2f2' : '#ecfdf5',
        border: isError ? '1px solid #fecaca' : '1px solid #a7f3d0',
        borderRadius: 8,
        marginBottom,
        color: isError ? '#b91c1c' : '#047857',
        fontSize: 13,
      }}
    >
      {isError
        ? <AlertTriangle size={16} style={{ flexShrink: 0 }} />
        : <CheckCircle size={16} style={{ flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
