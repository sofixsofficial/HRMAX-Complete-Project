import { useState } from 'react'
import { Trash2, AlertTriangle, Shield, Mail, CheckCircle, Loader2 } from 'lucide-react'

export function DeleteAccount() {
  const [email, setEmail] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [reason, setReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !confirmDelete) return
    setLoading(true)
    // Simulate submission (in production, this would call a Cloud Function)
    await new Promise(r => setTimeout(r, 1500))
    setLoading(false)
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div style={{ background: '#fff', color: '#111827', minHeight: '100vh', paddingTop: 68 }}>
        <section style={{ padding: '80px 24px', maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <CheckCircle size={32} color="#16a34a" />
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Deletion Request Received</h1>
          <p style={{ color: '#6b7280', fontSize: 15, lineHeight: 1.7, marginBottom: 24 }}>
            Your account deletion request has been submitted successfully. Our team will review and process your request within <strong>30 business days</strong>.
          </p>
          <div style={{ background: '#f9fafb', borderRadius: 12, padding: 24, textAlign: 'left', border: '1px solid #f3f4f6' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 12 }}>What happens next:</h3>
            <ul style={{ margin: 0, paddingLeft: 20, color: '#6b7280', fontSize: 14, lineHeight: 2 }}>
              <li>We will verify your identity using the email provided</li>
              <li>Your personal data will be permanently deleted from our systems</li>
              <li>Attendance records and payroll data may be retained for legal compliance (up to 7 years as required by Indian labor laws)</li>
              <li>You will receive a confirmation email once deletion is complete</li>
            </ul>
          </div>
          <p style={{ color: '#9ca3af', fontSize: 13, marginTop: 24 }}>
            Reference: DEL-{Date.now().toString(36).toUpperCase()} | Email: {email}
          </p>
        </section>
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', color: '#111827', minHeight: '100vh', paddingTop: 68 }}>
      {/* Header */}
      <section style={{ padding: '64px 24px', textAlign: 'center', background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fee2e2', color: '#dc2626', padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
            <Trash2 size={16} /> Account Deletion
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 16, color: '#111827' }}>
            Request Account <span style={{ color: '#dc2626' }}>Deletion</span>
          </h1>
          <p style={{ fontSize: 16, color: '#6b7280', lineHeight: 1.7 }}>
            You can request permanent deletion of your HR MAX account and associated personal data.
          </p>
        </div>
      </section>

      {/* Warning */}
      <section style={{ padding: '24px 24px', maxWidth: 600, margin: '0 auto' }}>
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 20, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <AlertTriangle size={20} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>Before You Delete</h3>
            <p style={{ fontSize: 13, color: '#a16207', lineHeight: 1.6, margin: 0 }}>
              Account deletion is <strong>permanent and irreversible</strong>. You will lose access to all HR data including attendance history, salary slips, leave records, and documents. Some data may be retained for legal compliance.
            </p>
          </div>
        </div>
      </section>

      {/* Data Retention Info */}
      <section style={{ padding: '24px 24px', maxWidth: 600, margin: '0 auto' }}>
        <div style={{ background: '#f9fafb', borderRadius: 12, padding: 24, border: '1px solid #f3f4f6' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 12 }}>
            <Shield size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
            Data That Will Be Deleted
          </h3>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#6b7280', fontSize: 13, lineHeight: 2 }}>
            <li>Profile information (name, phone, designation, department)</li>
            <li>Attendance records (check-in/out, GPS coordinates, device info)</li>
            <li>Leave requests and approval history</li>
            <li>Salary slips and payroll data</li>
            <li>Tasks, support tickets, and announcements</li>
            <li>Uploaded documents (Aadhar, PAN, offer letter, etc.)</li>
            <li>Push notification tokens</li>
            <li>All associated device and session data</li>
          </ul>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginTop: 16, marginBottom: 8 }}>
            Data Retained for Legal Compliance
          </h3>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#6b7280', fontSize: 13, lineHeight: 2 }}>
            <li>Payroll records (retained for 7 years per Indian Income Tax Act)</li>
            <li>Employment records (retained per Indian labor law requirements)</li>
            <li>Audit logs (retained for security and compliance)</li>
          </ul>
        </div>
      </section>

      {/* Form */}
      <section style={{ padding: '32px 24px', maxWidth: 600, margin: '0 auto' }}>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Email Address <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} color="#9ca3af" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your.email@company.com"
                style={{ width: '100%', padding: '12px 12px 12px 38px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Must match the email associated with your HR MAX account</p>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Employee ID (Optional)
            </label>
            <input
              type="text"
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              placeholder="EMP001"
              style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Reason for Deletion (Optional)
            </label>
            <select
              value={reason}
              onChange={e => setReason(e.target.value)}
              style={{ width: '100%', padding: '12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, outline: 'none', boxSizing: 'border-box', background: '#fff' }}
            >
              <option value="">Select a reason...</option>
              <option value="left-company">I left the company</option>
              <option value="no-longer-needed">No longer need the app</option>
              <option value="privacy-concerns">Privacy concerns</option>
              <option value="switching-app">Switching to another app</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={confirmDelete}
                onChange={e => setConfirmDelete(e.target.checked)}
                style={{ marginTop: 3, width: 16, height: 16 }}
              />
              <span style={{ fontSize: 14, color: '#374151', lineHeight: 1.5 }}>
                I understand that account deletion is <strong>permanent and irreversible</strong>. I will lose access to all my HR data including attendance, salary slips, leave records, and documents. Some data may be retained for legal compliance as outlined above.
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={!email || !confirmDelete || loading}
            style={{
              width: '100%',
              padding: '14px 24px',
              borderRadius: 8,
              border: 'none',
              background: email && confirmDelete && !loading ? '#dc2626' : '#d1d5db',
              color: '#fff',
              fontSize: 15,
              fontWeight: 600,
              cursor: email && confirmDelete && !loading ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? (
              <><Loader2 size={18} className="animate-spin" /> Processing Request...</>
            ) : (
              <><Trash2 size={18} /> Request Account Deletion</>
            )}
          </button>
        </form>
      </section>

      {/* Contact */}
      <section style={{ padding: '32px 24px', maxWidth: 600, margin: '0 auto', borderTop: '1px solid #f3f4f6' }}>
        <p style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
          Need help? Contact us at <a href="mailto:info@hrmax.in" style={{ color: '#f97316' }}>info@hrmax.in</a> or call <a href="tel:9601582622" style={{ color: '#f97316' }}>9601582622</a>
        </p>
      </section>
    </div>
  )
}
