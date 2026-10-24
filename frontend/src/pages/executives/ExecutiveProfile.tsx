import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Mail, Shield, Briefcase, CreditCard, MapPin, DollarSign,
  Building2, Users, Crown, Loader2, AlertCircle, Eye, User as UserIcon,
  CheckCircle, XCircle
} from 'lucide-react'
import { doc, getDoc } from '../../aws/firestore-compat'
import { db } from '../../aws/clients'
import { logAudit } from '../../services/auditLogService'
import { getAllCompanies } from '../../services/companyService'
import { getAllUsers } from '../../services/authService'
import { useAuth } from '../../context/AuthContext'
import { Header } from '../../components/Header'
import type { User, Company } from '../../types/user'
import '../Employees.css'

export function ExecutiveProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user: authUser } = useAuth()

  const [profile, setProfile] = useState<User | null>(null)
  const [allTeamLeaders, setAllTeamLeaders] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [auditLogged, setAuditLogged] = useState(false)

  useEffect(() => {
    if (!id) { setError('No user ID provided'); setLoading(false); return }

    Promise.all([
      getDoc(doc(db, 'users', id)),
      getAllCompanies().catch(() => [] as Company[]),
      getAllUsers().catch(() => [] as User[]),
    ]).then(([userSnap, comps, allUsers]) => {
      if (!userSnap.exists()) {
        setError('Executive not found')
        setLoading(false)
        return
      }
      const userData = { id: userSnap.id, ...userSnap.data() } as User
      setProfile(userData)
      setCompanies(comps)
      setAllTeamLeaders(allUsers.filter(u => u.role === 'team-leader'))
      setLoading(false)
    }).catch(err => {
      console.error('Error loading executive profile:', err)
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
        action: 'Viewed executive profile',
        actionType: 'read',
        module: 'Executive Profile',
        targetEntity: profile.name || profile.id,
        status: 'success',
        details: `Executive ID: ${profile.id}`,
      })
      setAuditLogged(true)
    }
  }, [profile, authUser, auditLogged])

  const handleBack = () => navigate('/executives')

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Executive Profile" breadcrumbs={['Dashboard', 'Executives', 'Profile']} />
        <div className="page-content">
          <div className="loading-container" style={{ minHeight: '40vh' }}>
            <Loader2 size={32} className="spinner" />
            <p>Loading executive profile...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="page-container">
        <Header title="Executive Profile" breadcrumbs={['Dashboard', 'Executives', 'Profile']} />
        <div className="page-content">
          <div className="empty-state" style={{ minHeight: '40vh' }}>
            <AlertCircle size={48} color="#ef4444" />
            <h4>Profile Not Found</h4>
            <p>{error || 'The requested executive could not be found.'}</p>
            <button className="btn-primary" onClick={handleBack}>
              <ArrowLeft size={16} /> Back to Executives
            </button>
          </div>
        </div>
      </div>
    )
  }

  const p = profile as any
  const perms = profile.permissions || []
  const compIds: string[] = p.assignedCompanyIds || []
  const tlIds: string[] = p.assignedTeamLeaderIds || []

  return (
    <div className="page-container">
      <Header title={profile.name} breadcrumbs={['Dashboard', 'Executives', profile.name]} />

      <div className="page-content">
        <button className="btn-secondary" onClick={handleBack} style={{ marginBottom: 24 }}>
          <ArrowLeft size={16} /> Back to Executives
        </button>

        <div className="emp-profile">
          <div className="emp-profile-header">
            <div>
              <h2>{profile.name}</h2>
              <p>{p.executiveTitle || 'Executive'}</p>
              <span className={`badge ${profile.isActive ? 'badge-success' : 'badge-danger'}`}>
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
                <div><label>Company</label><span>{companies.find(c => c.id === profile.companyId)?.name || profile.companyId || '-'}</span></div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><Shield size={16} /> Account</h4>
              <div className="emp-profile-fields">
                <div><label>Role</label><span>Executive</span></div>
                <div><label>Department</label><span>{p.department || '-'}</span></div>
                <div><label>Permissions</label><span>{profile.permissions?.length || 0} of 48</span></div>
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
                        <span className="badge badge-success">Verified</span>
                        {(authUser?.role === 'master-admin' || authUser?.id === profile.id) && (
                          <button className="emp-action-icon view" title="View Document" onClick={() => window.open(p.aadharDoc, '_blank')}>
                            <Eye size={14} />
                          </button>
                        )}
                      </>
                    ) : p.aadharNumber ? (
                      <span className="badge badge-warning">Pending</span>
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
                        <span className="badge badge-success">Verified</span>
                        {(authUser?.role === 'master-admin' || authUser?.id === profile.id) && (
                          <button className="emp-action-icon view" title="View Document" onClick={() => window.open(p.panDoc, '_blank')}>
                            <Eye size={14} />
                          </button>
                        )}
                      </>
                    ) : p.panNumber ? (
                      <span className="badge badge-warning">Pending</span>
                    ) : (
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>Not provided</span>
                    )}
                  </span>
                </div>
                <div>
                  <label>Joining Letter</label>
                  <span>
                    {p.joiningLetterDoc ? (
                      <>
                        <span className="badge badge-success">Uploaded</span>
                        {(authUser?.role === 'master-admin' || authUser?.id === profile.id) && (
                          <button className="emp-action-icon view" title="View" onClick={() => window.open(p.joiningLetterDoc, '_blank')}>
                            <Eye size={14} />
                          </button>
                        )}
                      </>
                    ) : <span className="text-gray-400 text-sm">Not uploaded</span>}
                  </span>
                </div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><CreditCard size={16} /> Bank & Statutory</h4>
              <div className="emp-profile-fields">
                <div><label>Bank</label><span>{p.bankName || '-'}</span></div>
                <div><label>Account Holder</label><span>{p.accountHolderName || '-'}</span></div>
                <div><label>Account No.</label><span>{p.accountNumber || '-'}</span></div>
                <div><label>IFSC</label><span>{p.ifscCode || '-'}</span></div>
                <div><label>PF Account</label><span>{p.pfAccountNumber || '-'}</span></div>
                <div><label>UAN</label><span>{p.uanNumber || '-'}</span></div>
                <div>
                  <label>Offer Letter</label>
                  <span>
                    {p.offerLetterDoc ? (
                      <>
                        <span className="badge badge-success">Uploaded</span>
                        {(authUser?.role === 'master-admin' || authUser?.id === profile.id) && (
                          <button className="emp-action-icon view" title="View" onClick={() => window.open(p.offerLetterDoc, '_blank')}>
                            <Eye size={14} />
                          </button>
                        )}
                      </>
                    ) : <span className="text-gray-400 text-sm">Not uploaded</span>}
                  </span>
                </div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><MapPin size={16} /> Address & Emergency</h4>
              <div className="emp-profile-fields">
                <div style={{ gridColumn: '1 / -1' }}><label>Address</label><span>{p.address || '-'}</span></div>
                <div><label>Emergency Contact</label><span>{p.emergencyContactName || '-'}</span></div>
                <div><label>Emergency Phone</label><span>{p.emergencyContactPhone || '-'}</span></div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><DollarSign size={16} /> Compensation</h4>
              <div className="emp-profile-fields">
                <div><label>Monthly Gross</label><span>${(Number(p.monthlyGrossSalary) || 0).toFixed(2)}</span></div>
                <div><label>Salary Effective</label><span>{p.salaryEffectiveDate || '-'}</span></div>
              </div>
            </div>

            {/* Permission Summary */}
            <div className="emp-profile-section">
              <h4><Shield size={16} /> Access & Permissions</h4>
              <div className="emp-profile-fields">
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="perm-profile-summary">
                    <div className="perm-profile-summary-tags">
                      {['Employees', 'Attendance', 'Leave', 'Payroll', 'Salary', 'Tasks', 'Holidays', 'Job Posts', 'Reports', 'Settings', 'Companies']
                        .map(mod => {
                          const modLower = mod.toLowerCase().replace(/\s+/g, '_')
                          const viewPerm = `${modLower}.view`
                          const hasAccess = perms.includes(viewPerm) || perms.includes('*')
                          if (!hasAccess) return null
                          const allActions = ['view', 'create', 'edit', 'delete', 'manage', 'approve']
                          const activeActions = allActions.filter(a => perms.includes(`${modLower}.${a}`))
                          const hasAll = activeActions.length >= 4
                          return (
                            <span key={mod} className={`perm-profile-tag ${hasAll ? 'all' : ''}`}>
                              {hasAll ? '✓ ' : ''}{mod}: {activeActions.map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ') || 'View'}
                            </span>
                          )
                        })
                        .filter(Boolean)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><Building2 size={16} /> Assigned Companies ({compIds.length})</h4>
              <div className="emp-profile-fields">
                {compIds.length === 0 ? (
                  <div><label>Companies</label><span className="text-gray-400">None assigned</span></div>
                ) : compIds.map((cId: string) => {
                  const comp = companies.find(c => c.id === cId)
                  return (
                    <div key={cId} className="exec-chip exec-chip-company">
                      <Building2 size={12} />
                      <span style={{ marginLeft: 4 }}>{comp?.name || cId}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="emp-profile-section">
              <h4><Users size={16} /> Reporting Team Leaders ({tlIds.length})</h4>
              <div className="emp-profile-fields">
                {tlIds.length === 0 ? (
                  <div><label>Team Leaders</label><span className="text-gray-400">None assigned</span></div>
                ) : tlIds.map((tlId: string) => {
                  const tl = allTeamLeaders.find(t => t.id === tlId)
                  return (
                    <div key={tlId} className="exec-chip exec-chip-tl">
                      <Crown size={12} />
                      <span style={{ marginLeft: 4 }}>{tl?.name || tlId}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
