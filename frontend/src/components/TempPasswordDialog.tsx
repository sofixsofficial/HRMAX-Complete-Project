import { useState } from 'react'
import { Copy, CheckCircle, KeyRound, ShieldCheck, AlertCircle } from 'lucide-react'
import { Modal } from './Modal'

interface TempPasswordDialogProps {
  /** Email of the account whose password was reset. */
  email: string
  /** The one-time temporary password returned by the reset endpoint. */
  tempPassword: string
  onClose: () => void
}

/**
 * Shown after an admin-triggered Reset Password (same dialog for every role:
 * employee, company admin, executive, team leader). Displays the temporary
 * password exactly once — it is never emailed — and explains how the target
 * replaces it with a permanent password.
 */
export const TempPasswordDialog = ({ email, tempPassword, onClose }: TempPasswordDialogProps) => {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tempPassword)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (non-secure context) — the value stays selectable.
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Temporary Password"
      size="medium"
      footer={<button className="btn-primary" onClick={onClose}>Done</button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#065f46' }}>
          <CheckCircle size={18} style={{ flexShrink: 0 }} />
          <span>Password reset for <b>{email}</b></span>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
            <KeyRound size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
            Temporary password
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <code style={{ flex: 1, display: 'block', background: '#f9fafb', border: '1px dashed #d1d5db', borderRadius: 8, padding: '12px 14px', fontSize: 18, letterSpacing: 1, fontWeight: 600, color: '#111827', wordBreak: 'break-all', userSelect: 'all' }}>
              {tempPassword}
            </code>
            <button type="button" className="btn-secondary" onClick={copy} title="Copy password" style={{ whiteSpace: 'nowrap' }}>
              {copied ? <CheckCircle size={15} /> : <Copy size={15} />}
              {copied ? ' Copied' : ' Copy'}
            </button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6b7280' }}>
            Shown once and never emailed — copy it now if you need to share it later.
          </p>
        </div>

        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#4b5563', lineHeight: 1.7 }}>
          <li>Share this temporary password with {email}.</li>
          <li>They sign in with it as usual.</li>
          <li>They are asked to set a permanent password right away — or later from <b>Settings → Change Password</b>.</li>
        </ol>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#92400e' }}>
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>The account cannot be used with the old password anymore.</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6b7280' }}>
          <ShieldCheck size={16} style={{ flexShrink: 0 }} />
          <span>This reset was recorded in the audit trail.</span>
        </div>
      </div>
    </Modal>
  )
}
