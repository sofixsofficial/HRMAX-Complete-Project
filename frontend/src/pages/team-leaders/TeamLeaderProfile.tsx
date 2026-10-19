import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Mail, Shield, Briefcase, CreditCard, MapPin, DollarSign,
  Building2, Crown, Activity, Loader2, AlertCircle, Eye, User as UserIcon,
  CheckCircle, XCircle
} from 'lucide-react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { logAudit } from '../../services/auditLogService'
import { getAllUsers } from '../../services/authService'
import { useAuth } from '../../context/AuthContext'
import { Header } from '../../components/Header'
import type { User } from '../../types/user'
import '../Employees.css'

export function TeamLeaderProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user: authUser } = useAuth()

  const [profile, setProfile] = useState<User | null>(null)
  const [executives, setExecutives] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [auditLogged, setAuditLogged] = useState(false)

  useEffect(() => {
    if (!id) { setError('No user ID provided'); setLoading(false); return }

    Promise.all([
      getDoc(doc(db, 'users', id)),
      getAllUsers().catch(() => [] as User[]),
    ]).then(([userSnap, allUsers]) => {
      if (!userSnap.exists()) {
        setError('Team Leader not found')
        setLoading(false)
        return
      }
      const userData = { id: userSnap.id, ...userSnap.data() } as User
      setProfile(userData)
      setExecutives(allUsers.filter(u => u.role === 'executive'))
      setLoading(false)
    }).catch(err => {
      console.error('Error loading team leader profile:', err)
      setError('Failed to load profile. Please try again.')
      setLoading(false)
    })
  }, [id])

  useEffect(() => {
    if (profile && authUser && !auditLogged) {
      logAudit({
        userId: authUser.id,
        userName: authUser.name || '',
        userRole: authUser.role || '',
        action: 'Viewed team leader profile',
        actionType: 'read',
        module: 'Team Leader Profile',
        targetEntity: profile.name || profile.id,
        status: 'success',
        details: `Team Leader ID: ${profile.id}`,
      })
      setAuditLogged(true)
    }
  }, [profile, authUser, auditLogged])

  const handleBack = () => navigate('/team-leaders')

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Team Leader Profile" breadcrumbs={['Dashboard', 'Team Leaders', 'Profile']} />
        <div className="page-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 12, color: '#6b7280' }}>
          <Loader2 size={24} className="animate-spin" />
          <span>Loading team leader profile...</span>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="page-container">
        <Header title="Team Leader Profile" breadcrumbs={['Dashboard', 'Team Leaders', 'Profile']} />
        <div className="page-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', gap: 16 }}>
          <AlertCircle size={48} color="#ef4444" />
          <h2 style={{ margin: 0, color: '#374151' }}>Profile Not Found</h2>
          <p style={{ color: '#9ca3af', margin: 0 }}>{error || 'The requested team leader could not be found.'}</p>
          <button className="btn-primary" onClick={handleBack}>
            <ArrowLeft size={16} /> Back to Team Leaders
          </button>
        </div>
      </div>
    )
  }

  const p = profile as any
  const linkedIds: string[] = p.linkedExecutiveIds || (p.reportingExecutiveId ? [p.reportingExecutiveId] : [])
  const linkedExecs = executives.filter(e => linkedIds.includes(e.id))

  return (
    <div className="page-container">
      <Header title={profile.name} breadcrumbs={['Dashboard', 'Team Leaders', profile.name]} />

      <div className="page-content">
        <button className="btn-secondary" onClick={handleBack} style={{ marginBottom: 20 }}>
          <ArrowLeft size={16} /> Back to Team Leaders
        </button>

        <div className="emp-profile">
          <div className="emp-profile-header">
            <div>
              <h2>{profile.name}</h2>
              <p>Team Leader{p.designation ? ` — ${p.designation}` : ''}</p>
              <span className="emp-status-badge" style={{ background: profile.isActive ? '#dcfce7' : '#fee2e2', color: profile.isActive ? '#16a34a' : '#ef4444' }}>
                {profile.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>

          <div className="emp-profile-grid">
            <div className="emp-profile-section">
              <h4><Mail size={16} /> Contact</h4>
              <div className="emp-profile-fields">
                <div><label>Email</label><span>{profile.email}</span></div>
                <div><label>Phone</label><span>{p.phone || '-'}</span></div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><Activity size={16} /> Contingency Access</h4>
              <div className="emp-profile-fields">
                <div>
                  <label>Status</label>
                  <span className="emp-status-badge" style={{ background: p.contingencyAccess ? '#fff7ed' : '#f3f4f6', color: p.contingencyAccess ? '#c2410c' : '#9ca3af' }}>
                    {p.contingencyAccess ? 'Active — Full executive permissions granted' : 'Inactive'}
                  </span>
                </div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><Briefcase size={16} /> Employment & Compliance</h4>
              <div className="emp-profile-fields">
                <div><label>Employment Type</label><span>{p.employmentType || '-'}</span></div>
                <div><label>Status</label><span>{p.status || '-'}</span></div>
                <div><label>Join Date</label><span>{p.joinDate || '-'}</span></div>
                <div>
                  <label>Aadhaar</label>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: '#6b7280', fontStyle: 'italic' }}>[Aadhaar Redacted]</span>
                    {p.aadharDoc ? (
                      <>
                        <span className="emp-status-badge" style={{ background: '#dcfce7', color: '#16a34a', fontSize: 11 }}>Verified</span>
                        {(authUser?.role === 'master-admin' || authUser?.id === profile.id) && (
                          <span className="hierarchy-count-badge" style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', cursor: 'pointer', fontSize: 11 }} onClick={() => window.open(p.aadharDoc, '_blank')}>
                            <Eye size={12} /> View Document
                          </span>
                        )}
                      </>
                    ) : p.aadharNumber ? (
                      <span className="emp-status-badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 11 }}>Pending</span>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>Not provided</span>
                    )}
                  </span>
                </div>
                <div>
                  <label>PAN</label>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: '#6b7280', fontStyle: 'italic' }}>[PAN Redacted]</span>
                    {p.panDoc ? (
                      <>
                        <span className="emp-status-badge" style={{ background: '#dcfce7', color: '#16a34a', fontSize: 11 }}>Verified</span>
                        {(authUser?.role === 'master-admin' || authUser?.id === profile.id) && (
                          <span className="hierarchy-count-badge" style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', cursor: 'pointer', fontSize: 11 }} onClick={() => window.open(p.panDoc, '_blank')}>
                            <Eye size={12} /> View Document
                          </span>
                        )}
                      </>
                    ) : p.panNumber ? (
                      <span className="emp-status-badge" style={{ background: '#fef3c7', color: '#d97706', fontSize: 11 }}>Pending</span>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>Not provided</span>
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><CreditCard size={16} /> Bank & Statutory</h4>
              <div className="emp-profile-fields">
                <div><label>Bank Name</label><span>{p.bankName || '-'}</span></div>
                <div><label>Account Holder</label><span>{p.accountHolderName || '-'}</span></div>
                <div><label>Account Number</label><span>{p.accountNumber || '-'}</span></div>
                <div><label>IFSC Code</label><span>{p.ifscCode || '-'}</span></div>
                <div><label>PF Account</label><span>{p.pfAccountNumber || '-'}</span></div>
                <div><label>UAN</label><span>{p.uanNumber || '-'}</span></div>
                <div>
                  <label>Offer Letter</label>
                  <span>
                    {p.offerLetterDoc ? (
                      <>
                        <span className="emp-status-badge" style={{ background: '#dcfce7', color: '#16a34a', fontSize: 11 }}>Uploaded</span>
                        {(authUser?.role === 'master-admin' || authUser?.id === profile.id) && (
                          <span className="hierarchy-count-badge" style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', cursor: 'pointer', fontSize: 11, marginLeft: 8 }} onClick={() => window.open(p.offerLetterDoc, '_blank')}>
                            <Eye size={12} /> View
                          </span>
                        )}
                      </>
                    ) : 'Not uploaded'}
                  </span>
                </div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><MapPin size={16} /> Contact Information</h4>
              <div className="emp-profile-fields">
                <div style={{ gridColumn: '1 / -1' }}><label>Address</label><span>{p.address || '-'}</span></div>
                <div><label>Emergency Contact</label><span>{p.emergencyContactName || '-'}</span></div>
                <div><label>Emergency Phone</label><span>{p.emergencyContactPhone || '-'}</span></div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><DollarSign size={16} /> Compensation</h4>
              <div className="emp-profile-fields">
                <div><label>Monthly Gross Salary</label><span>${(Number(p.monthlyGrossSalary) || 0).toFixed(2)}</span></div>
                <div><label>Salary Effective Date</label><span>{p.salaryEffectiveDate || '-'}</span></div>
              </div>
            </div>

            <div className="emp-profile-section" style={{ border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: 8, padding: 16 }}>
              <h4 style={{ color: '#c2410c' }}><Crown size={16} /> Reporting Structure</h4>
              <div className="emp-profile-fields">
                {linkedExecs.length > 0 ? (
                  <>
                    <div style={{ marginBottom: 8 }}>
                      <label>Total Executives Managed</label>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="hierarchy-count-badge" style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}>
                          <Crown size={12} /> {linkedExecs.length}
                        </span>
                      </span>
                    </div>
                    <div style={{ borderTop: '1px solid #fed7aa', paddingTop: 10 }}>
                      <label style={{ fontWeight: 600, color: '#9a3412', marginBottom: 8, display: 'block' }}>Linked Executives</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {linkedExecs.map(ex => {
                          const compCount = (ex as any)?.assignedCompanyIds?.length || 0
                          return (
                            <div key={ex.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#fff', borderRadius: 8, border: '1px solid #fed7aa' }}>
                              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f97316', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 14, flexShrink: 0 }}>
                                {ex.name.charAt(0)}
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>{ex.name}</div>
                                <div style={{ fontSize: 12, color: '#6b7280' }}>{(ex as any)?.executiveTitle || 'Executive'}</div>
                                {compCount > 0 && (
                                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{compCount} company{compCount !== 1 ? 'ies' : 'y'}</div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div>
                    <label>Total Executives Managed</label>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="hierarchy-count-badge" style={{ background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb' }}>
                        <Crown size={12} /> 0
                      </span>
                    </span>
                    <div style={{ marginTop: 12, padding: '10px 12px', background: '#fff', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                      <span style={{ color: '#9ca3af', fontSize: 13 }}>Not linked to any executive.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
