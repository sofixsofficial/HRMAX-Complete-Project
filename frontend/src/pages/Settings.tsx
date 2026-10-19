import { useState, useEffect, useMemo } from 'react'
import { User, Bell, Shield, Settings as SettingsIcon, Building2, FileText, Users, Save, ChevronRight, Loader2, AlertCircle, CheckCircle, X, Globe, Activity, Clock, Eye, EyeOff } from 'lucide-react'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { updateUserProfile, updateUserPassword, reauthenticateUser } from '../services/authService'
import { logAudit } from '../services/auditLogService'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, orderBy, limit } from 'firebase/firestore'
import { db } from '../config/firebase'
import './Settings.css'

export function Settings() {
  const [activeTab, setActiveTab] = useState('profile')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const { user } = useAuth()
  const { effectiveCompanyId, availableCompanies, selectedCompanyName } = usePermissionScope('settings')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  // State preservation - restore previous path
  useEffect(() => {
    const from = searchParams.get('from')
    if (from) {
      sessionStorage.setItem('settings_return_path', from)
    }
  }, [searchParams])

  const isMasterAdmin = user?.role === 'master-admin'
  const isExecutive = user?.role === 'executive'
  const isCompanyAdmin = user?.role === 'company-admin'

  // Profile form state
  const [profileData, setProfileData] = useState({ fullName: '', email: '', phone: '', jobTitle: '', bio: '' })
  const [notificationSettings, setNotificationSettings] = useState({ emailNotifications: true, pushNotifications: true, smsAlerts: false })
  const [securitySettings, setSecuritySettings] = useState({ currentPassword: '', newPassword: '', confirmPassword: '', twoFactorEnabled: false })
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)

  // System Configuration states
  const [sysUsers, setSysUsers] = useState<any[]>([])
  const [sysUsersLoading, setSysUsersLoading] = useState(false)
  const [recentAuditLogs, setRecentAuditLogs] = useState<any[]>([])
  const [auditLogsLoading, setAuditLogsLoading] = useState(false)

  // Security Protocols state
  const [securityProtocols, setSecurityProtocols] = useState({
    sessionTimeout: 30,
    maxLoginAttempts: 5,
    passwordMinLength: 8,
    requireMfa: false,
    ipWhitelistEnabled: false,
  })

  // Company Settings state (for executives / company-admin)
  const [companySettings, setCompanySettings] = useState<any>(null)
  const [companySettingsLoading, setCompanySettingsLoading] = useState(false)

  // Attendance Settings state
  const [attendanceSettings, setAttendanceSettings] = useState({
    gracePeriodMinutes: 15,
    missedPunchThresholdMinutes: 60,
    autoApprovalEnabled: true,
  })
  const [attendanceSettingsLoading, setAttendanceSettingsLoading] = useState(false)

  useEffect(() => {
    if (user) {
      setProfileData({ fullName: user.name || '', email: user.email || '', phone: '', jobTitle: user.role || '', bio: '' })
    }
  }, [user])

  // Tab definitions with role-gating
  const tabs = useMemo(() => {
    const allTabs: { id: string; label: string; icon: any; roles?: string[] }[] = [
      { id: 'profile', label: 'Profile Settings', icon: User },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'security', label: 'Security', icon: Shield },
    ]

    if (isMasterAdmin) {
      allTabs.push(
        { id: 'system-config', label: 'System Configuration', icon: SettingsIcon, roles: ['master-admin'] },
      )
    }

    if (isExecutive || isCompanyAdmin) {
      allTabs.push(
        { id: 'company-settings', label: 'Company Settings', icon: Building2, roles: ['executive', 'company-admin'] },
        { id: 'attendance-settings', label: 'Attendance Settings', icon: Clock, roles: ['executive', 'company-admin'] },
      )
    }

    return allTabs
  }, [isMasterAdmin, isExecutive, isCompanyAdmin])

  // Load system users
  useEffect(() => {
    if (activeTab === 'system-config' && isMasterAdmin && sysUsers.length === 0) {
      setSysUsersLoading(true)
      getDocs(collection(db, 'users')).then(snap => {
        setSysUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      }).catch(() => {}).finally(() => setSysUsersLoading(false))
    }
  }, [activeTab, isMasterAdmin])

  // Load recent audit logs
  useEffect(() => {
    if (activeTab === 'system-config' && isMasterAdmin && recentAuditLogs.length === 0) {
      setAuditLogsLoading(true)
      const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(10))
      getDocs(q).then(snap => {
        setRecentAuditLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      }).catch(() => {}).finally(() => setAuditLogsLoading(false))
    }
  }, [activeTab, isMasterAdmin])

  // Load company settings
  useEffect(() => {
    if (activeTab === 'company-settings' && (isExecutive || isCompanyAdmin) && !companySettings) {
      setCompanySettingsLoading(true)
      const settingsCompanyId = effectiveCompanyId || user?.companyId
      if (!settingsCompanyId) { setCompanySettingsLoading(false); return }
      getDoc(doc(db, 'companies', settingsCompanyId)).then((snap: any) => {
        if (snap.exists()) setCompanySettings({ id: snap.id, ...snap.data() })
      }).catch(() => {}).finally(() => setCompanySettingsLoading(false))
    }
  }, [activeTab, isExecutive, isCompanyAdmin, effectiveCompanyId, user?.companyId])

  // Load attendance settings
  useEffect(() => {
    if (activeTab !== 'attendance-settings' || (!isExecutive && !isCompanyAdmin)) return
    setAttendanceSettingsLoading(true)
    const cId = effectiveCompanyId || user?.companyId || ''
    if (!cId) { setAttendanceSettingsLoading(false); return }
    import('../services/shiftService').then(({ getCompanySettings }) => {
      return getCompanySettings(cId)
    }).then(settings => {
      if (settings) {
        setAttendanceSettings({
          gracePeriodMinutes: settings.gracePeriodMinutes,
          missedPunchThresholdMinutes: settings.missedPunchThresholdMinutes,
          autoApprovalEnabled: settings.autoApprovalEnabled,
        })
      }
    }).catch(() => {}).finally(() => setAttendanceSettingsLoading(false))
  }, [activeTab, isExecutive, isCompanyAdmin, effectiveCompanyId, user?.companyId])

  const handleBack = () => {
    const returnPath = sessionStorage.getItem('settings_return_path')
    if (returnPath) {
      sessionStorage.removeItem('settings_return_path')
      navigate(returnPath)
    } else {
      navigate('/')
    }
  }

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setProfileData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSaveProfile = async () => {
    if (!user) return
    setSaving(true); setError(null); setSuccess(null)
    try {
      await updateUserProfile({ name: profileData.fullName })
      logAudit({ userId: user.id, userName: user.name, userRole: user.role, action: 'Updated profile settings', actionType: 'update', module: 'Settings', targetEntity: user.name, companyId: effectiveCompanyId || undefined, status: 'success' })
      setSuccess('Profile updated successfully!')
    } catch (err) {
      console.error('Error updating profile:', err)
      setError('Failed to update profile. Please try again.')
    } finally { setSaving(false) }
  }

  const handleNotificationChange = (key: string) => {
    setNotificationSettings(prev => ({ ...prev, [key]: !prev[key as keyof typeof notificationSettings] }))
  }

  const getPasswordStrength = (pw: string): { score: number; label: string; color: string } => {
    let score = 0
    if (pw.length >= 6) score++
    if (pw.length >= 8) score++
    if (/[A-Z]/.test(pw)) score++
    if (/[a-z]/.test(pw)) score++
    if (/[0-9]/.test(pw)) score++
    if (/[^A-Za-z0-9]/.test(pw)) score++
    const labels = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong', 'Excellent']
    const colors = ['#dc2626', '#f59e0b', '#eab308', '#22c55e', '#16a34a', '#15803d']
    return { score: Math.min(score, 5), label: labels[Math.min(score, 5)], color: colors[Math.min(score, 5)] }
  }

  const handleSecurityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSecuritySettings(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSaveSecurity = async () => {
    if (!securitySettings.currentPassword) {
      setError('Please enter your current password'); return
    }
    if (!securitySettings.newPassword) {
      setError('Please enter a new password'); return
    }
    if (securitySettings.newPassword.length < 6) {
      setError('New password must be at least 6 characters'); return
    }
    if (securitySettings.newPassword !== securitySettings.confirmPassword) {
      setError('Passwords do not match'); return
    }
    const strength = getPasswordStrength(securitySettings.newPassword)
    if (strength.score < 2) {
      setError('Password is too weak. Use a mix of uppercase, lowercase, numbers, and special characters.'); return
    }
    setSaving(true); setError(null); setSuccess(null)
    try {
      await reauthenticateUser(securitySettings.currentPassword)
      await updateUserPassword(securitySettings.newPassword)
      logAudit({ userId: user.id, userName: user.name, userRole: user.role, action: 'Changed password', actionType: 'update', module: 'Settings', targetEntity: user.name, companyId: effectiveCompanyId || undefined, status: 'success' })
      setSuccess('Password updated successfully!')
      setSecuritySettings(prev => ({ ...prev, currentPassword: '', newPassword: '', confirmPassword: '' }))
    } catch (err: any) {
      setError(err.message || 'Failed to update password. Please try again.')
    } finally { setSaving(false) }
  }

  const handleSaveSecurityProtocols = async () => {
    setSaving(true); setError(null); setSuccess(null)
    try {
      logAudit({ userId: user.id, userName: user.name, userRole: user.role, action: 'Updated security protocols', actionType: 'update', module: 'Settings', targetEntity: 'System Security', companyId: effectiveCompanyId || undefined, status: 'success', details: JSON.stringify(securityProtocols) })
      setSuccess('Security protocols updated!')
    } catch (err) {
      setError('Failed to update security protocols.')
    } finally { setSaving(false) }
  }

  return (
    <div className="page-container">
      <Header title="Settings" breadcrumbs={['Dashboard', 'Settings']} />

      <div className="page-content">
        {error && (
          <div className="error-banner">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button onClick={() => setError(null)}><X size={14} /></button>
          </div>
        )}

        {success && (
          <div className="success-banner">
            <CheckCircle size={18} />
            <span>{success}</span>
            <button onClick={() => setSuccess(null)}><X size={14} /></button>
          </div>
        )}

        <div className="settings-layout">
          <div className="settings-sidebar">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`settings-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon size={18} />
                <span>{tab.label}</span>
                <ChevronRight size={16} className="tab-arrow" />
              </button>
            ))}
            <div className="settings-sidebar-footer">
              <button className="btn-secondary settings-back-btn" onClick={handleBack}>
                <ChevronRight size={16} /> Back
              </button>
            </div>
          </div>

          <div className="settings-content">
            {/* PROFILE TAB */}
            {activeTab === 'profile' && (
              <div className="settings-section">
                <h3>Profile Settings</h3>
                <p className="section-description">Manage your personal information and profile details.</p>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Full Name</label>
                    <input type="text" name="fullName" value={profileData.fullName} onChange={handleProfileChange} placeholder="Enter your full name" />
                  </div>
                  <div className="form-group">
                    <label>Email Address</label>
                    <input type="email" name="email" value={profileData.email} onChange={handleProfileChange} placeholder="Enter your email" />
                  </div>
                  <div className="form-group">
                    <label>Phone Number</label>
                    <input type="tel" name="phone" value={profileData.phone} onChange={handleProfileChange} placeholder="Enter your phone number" />
                  </div>
                  <div className="form-group">
                    <label>Job Title</label>
                    <input type="text" name="jobTitle" value={profileData.jobTitle} onChange={handleProfileChange} placeholder="Enter your job title" readOnly />
                  </div>
                  <div className="form-group full-width">
                    <label>Bio</label>
                    <textarea name="bio" rows={4} value={profileData.bio} onChange={handleProfileChange} placeholder="Tell us about yourself..." />
                  </div>
                </div>
                <div className="settings-actions">
                  <button className="btn-secondary" onClick={() => { if (user) setProfileData({ fullName: user.name || '', email: user.email || '', phone: '', jobTitle: user.role || '', bio: '' }) }}>Reset</button>
                  <button className="btn-primary" onClick={handleSaveProfile} disabled={saving}>
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {/* NOTIFICATIONS TAB */}
            {activeTab === 'notifications' && (
              <div className="settings-section">
                <h3>Notification Preferences</h3>
                <p className="section-description">Choose how you want to be notified.</p>
                <div className="toggle-list">
                  <div className="toggle-item">
                    <div className="toggle-info"><h4>Email Notifications</h4><p>Receive email updates about system activities</p></div>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={notificationSettings.emailNotifications} onChange={() => handleNotificationChange('emailNotifications')} />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                  <div className="toggle-item">
                    <div className="toggle-info"><h4>Push Notifications</h4><p>Get push notifications in your browser</p></div>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={notificationSettings.pushNotifications} onChange={() => handleNotificationChange('pushNotifications')} />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                  <div className="toggle-item">
                    <div className="toggle-info"><h4>SMS Alerts</h4><p>Receive SMS for critical alerts</p></div>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={notificationSettings.smsAlerts} onChange={() => handleNotificationChange('smsAlerts')} />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                </div>
                <div className="settings-actions">
                  <button className="btn-secondary">Reset</button>
                  <button className="btn-primary" onClick={() => {
                    if (user) logAudit({ userId: user.id, userName: user.name, userRole: user.role, action: 'Updated notification preferences', actionType: 'update', module: 'Settings', targetEntity: user.name, companyId: effectiveCompanyId || undefined, status: 'success', details: `email: ${notificationSettings.emailNotifications}, push: ${notificationSettings.pushNotifications}, sms: ${notificationSettings.smsAlerts}` })
                    setSuccess('Notification preferences saved!')
                  }}>
                    <Save size={16} />Save Changes
                  </button>
                </div>
              </div>
            )}

            {/* SECURITY TAB */}
            {activeTab === 'security' && (
              <div className="settings-section">
                <h3>Security Settings</h3>
                <p className="section-description">Manage your account security and authentication.</p>
                <div className="form-grid">
                  <div className="form-group full-width">
                    <label>Current Password</label>
                    <div className="input-with-toggle">
                      <input type={showCurrentPw ? 'text' : 'password'} name="currentPassword" value={securitySettings.currentPassword} onChange={handleSecurityChange} placeholder="Enter current password" />
                      <button type="button" className="pw-toggle" onClick={() => setShowCurrentPw(!showCurrentPw)}>
                        {showCurrentPw ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>New Password</label>
                    <div className="input-with-toggle">
                      <input type={showNewPw ? 'text' : 'password'} name="newPassword" value={securitySettings.newPassword} onChange={handleSecurityChange} placeholder="Enter new password" />
                      <button type="button" className="pw-toggle" onClick={() => setShowNewPw(!showNewPw)}>
                        {showNewPw ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {securitySettings.newPassword && (() => {
                      const s = getPasswordStrength(securitySettings.newPassword)
                      return (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                            {Array.from({ length: 6 }).map((_, i) => (
                              <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i < s.score ? s.color : '#e5e7eb' }} />
                            ))}
                          </div>
                          <span style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.label}</span>
                        </div>
                      )
                    })()}
                  </div>
                  <div className="form-group">
                    <label>Confirm Password</label>
                    <div className="input-with-toggle">
                      <input type={showConfirmPw ? 'text' : 'password'} name="confirmPassword" value={securitySettings.confirmPassword} onChange={handleSecurityChange} placeholder="Confirm new password" />
                      <button type="button" className="pw-toggle" onClick={() => setShowConfirmPw(!showConfirmPw)}>
                        {showConfirmPw ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {securitySettings.confirmPassword && securitySettings.newPassword !== securitySettings.confirmPassword && (
                      <span style={{ fontSize: 12, color: '#dc2626', marginTop: 2 }}>Passwords do not match</span>
                    )}
                  </div>
                </div>
                <div className="security-options">
                  <h4>Two-Factor Authentication</h4>
                  <div className="toggle-item">
                    <div className="toggle-info"><p>Enable 2FA for additional security</p></div>
                    <label className="toggle-switch">
                      <input type="checkbox" checked={securitySettings.twoFactorEnabled} onChange={() => setSecuritySettings(prev => ({ ...prev, twoFactorEnabled: !prev.twoFactorEnabled }))} />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>
                </div>
                <div className="settings-actions">
                  <button className="btn-secondary" onClick={() => setSecuritySettings({ currentPassword: '', newPassword: '', confirmPassword: '', twoFactorEnabled: false })}>Cancel</button>
                  <button className="btn-primary" onClick={handleSaveSecurity} disabled={saving}>
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {/* SYSTEM CONFIGURATION TAB (Master Admin only) */}
            {activeTab === 'system-config' && isMasterAdmin && (
              <div className="settings-section">
                <h3>System Configuration</h3>
                <p className="section-description">Manage global system settings, security protocols, API keys, and view recent audit logs.</p>

                {/* User Management Overview */}
                <div className="sc-subsection">
                  <div className="sc-subsection-header">
                    <Users size={18} className="sc-icon" />
                    <h4>User Management</h4>
                  </div>
                  {sysUsersLoading ? (
                    <div className="sc-loading"><Loader2 size={16} className="animate-spin" /> Loading users...</div>
                  ) : (
                    <div className="sc-users-grid">
                      <div className="sc-user-stat"><span className="sc-stat-label">Total Users</span><span className="sc-stat-value">{sysUsers.length}</span></div>
                      <div className="sc-user-stat"><span className="sc-stat-label">Master Admins</span><span className="sc-stat-value">{sysUsers.filter((u: any) => u.role === 'master-admin').length}</span></div>
                      <div className="sc-user-stat"><span className="sc-stat-label">Company Admins</span><span className="sc-stat-value">{sysUsers.filter((u: any) => u.role === 'company-admin').length}</span></div>
                      <div className="sc-user-stat"><span className="sc-stat-label">Executives</span><span className="sc-stat-value">{sysUsers.filter((u: any) => u.role === 'executive').length}</span></div>
                      <div className="sc-user-stat"><span className="sc-stat-label">Team Leaders</span><span className="sc-stat-value">{sysUsers.filter((u: any) => u.role === 'team-leader').length}</span></div>
                      <div className="sc-user-stat"><span className="sc-stat-label">Employees</span><span className="sc-stat-value">{sysUsers.filter((u: any) => u.role === 'employee').length}</span></div>
                    </div>
                  )}
                </div>

                {/* Security Protocols */}
                <div className="sc-subsection">
                  <div className="sc-subsection-header">
                    <Shield size={18} className="sc-icon" />
                    <h4>Security Protocols</h4>
                  </div>
                  <div className="sc-protocols-grid">
                    <div className="form-group">
                      <label>Session Timeout (minutes)</label>
                      <input type="number" value={securityProtocols.sessionTimeout} onChange={(e) => setSecurityProtocols(prev => ({ ...prev, sessionTimeout: parseInt(e.target.value) || 30 }))} min={5} max={120} />
                    </div>
                    <div className="form-group">
                      <label>Max Login Attempts</label>
                      <input type="number" value={securityProtocols.maxLoginAttempts} onChange={(e) => setSecurityProtocols(prev => ({ ...prev, maxLoginAttempts: parseInt(e.target.value) || 5 }))} min={1} max={20} />
                    </div>
                    <div className="form-group">
                      <label>Minimum Password Length</label>
                      <input type="number" value={securityProtocols.passwordMinLength} onChange={(e) => setSecurityProtocols(prev => ({ ...prev, passwordMinLength: parseInt(e.target.value) || 8 }))} min={6} max={32} />
                    </div>
                    <div className="form-group sc-toggle-group">
                      <label>Require Multi-Factor Auth</label>
                      <label className="toggle-switch">
                        <input type="checkbox" checked={securityProtocols.requireMfa} onChange={() => setSecurityProtocols(prev => ({ ...prev, requireMfa: !prev.requireMfa }))} />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                    <div className="form-group sc-toggle-group">
                      <label>IP Whitelist Enforcement</label>
                      <label className="toggle-switch">
                        <input type="checkbox" checked={securityProtocols.ipWhitelistEnabled} onChange={() => setSecurityProtocols(prev => ({ ...prev, ipWhitelistEnabled: !prev.ipWhitelistEnabled }))} />
                        <span className="toggle-slider"></span>
                      </label>
                    </div>
                  </div>
                  <div className="settings-actions">
                    <button className="btn-primary" onClick={handleSaveSecurityProtocols} disabled={saving}>
                      {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      {saving ? 'Saving...' : 'Save Protocols'}
                    </button>
                  </div>
                </div>
                {/* Recent Audit Logs */}
                <div className="sc-subsection">
                  <div className="sc-subsection-header">
                    <FileText size={18} className="sc-icon" />
                    <h4>Recent Audit Logs</h4>
                    <button className="btn-link" onClick={() => navigate('/audit-logs')}>View All</button>
                  </div>
                  {auditLogsLoading ? (
                    <div className="sc-loading"><Loader2 size={16} className="animate-spin" /> Loading audit logs...</div>
                  ) : (
                    <div className="sc-audit-list">
                      {recentAuditLogs.map((log: any) => (
                        <div key={log.id} className="sc-audit-item">
                          <Activity size={14} className="sc-audit-icon" />
                          <div className="sc-audit-content">
                            <span className="sc-audit-action">{log.action}</span>
                            <span className="sc-audit-user">{log.userName}</span>
                          </div>
                          <Clock size={12} className="sc-audit-time-icon" />
                          <span className="sc-audit-time">
                            {log.timestamp?.toDate?.()?.toLocaleString() || log.timestamp || ''}
                          </span>
                        </div>
                      ))}
                      {recentAuditLogs.length === 0 && <p className="sc-empty">No recent audit logs found.</p>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* COMPANY SETTINGS TAB (Executive / Company Admin) */}
            {activeTab === 'company-settings' && (isExecutive || isCompanyAdmin) && (
              <div className="settings-section">
                <h3>Company Settings</h3>
                <p className="section-description">
                  {isExecutive
                    ? 'View your assigned company information. Changes require Master Admin approval.'
                    : 'Manage your company information and preferences.'}
                </p>

                {companySettingsLoading ? (
                  <div className="sc-loading"><Loader2 size={16} className="animate-spin" /> Loading company settings...</div>
                ) : companySettings ? (
                  <div className="sc-company-settings">
                    <div className="sc-company-header">
                      <div className="sc-company-avatar" style={{ background: companySettings.logoColor || '#f97316' }}>
                        {companySettings.name?.charAt(0)?.toUpperCase() || 'C'}
                      </div>
                      <div className="sc-company-title">
                        <h4>{companySettings.name}</h4>
                        <span className="sc-company-domain">{companySettings.domain || companySettings.website || 'No domain set'}</span>
                      </div>
                      <span className={`sc-company-status ${companySettings.status === 'Active' ? 'active' : ''}`}>
                        {companySettings.status || 'Active'}
                      </span>
                    </div>

                    <div className="form-grid">
                      <div className="form-group">
                        <label>Company Code</label>
                        <input type="text" value={companySettings.code || ''} readOnly className="readonly-input" />
                      </div>
                      <div className="form-group">
                        <label>Industry</label>
                        <input type="text" value={companySettings.industry || 'Not specified'} readOnly className="readonly-input" />
                      </div>
                      <div className="form-group">
                        <label>Phone</label>
                        <input type="text" value={companySettings.phone || 'Not specified'} readOnly={!isExecutive} />
                      </div>
                      <div className="form-group">
                        <label>Website</label>
                        <input type="text" value={companySettings.website || 'Not specified'} readOnly={!isExecutive} />
                      </div>
                      <div className="form-group">
                        <label>Operational Mode</label>
                        <input type="text" value={companySettings.operationalMode || 'Continuous'} readOnly className="readonly-input" />
                      </div>
                      <div className="form-group">
                        <label>Employees</label>
                        <input type="text" value={`${companySettings.employees || 0}`} readOnly className="readonly-input" />
                      </div>
                      <div className="form-group full-width">
                        <label>Address</label>
                        <input type="text" value={companySettings.address || 'Not specified'} readOnly={!isExecutive} />
                      </div>
                      <div className="form-group full-width">
                        <label>Description</label>
                        <textarea rows={3} value={companySettings.description || 'No description'} readOnly={!isExecutive} />
                      </div>
                    </div>

                    {isExecutive && (
                      <div className="settings-actions">
                        <button className="btn-primary">
                          <Save size={16} /> Save Changes
                        </button>
                      </div>
                    )}

                    {!isExecutive && (
                      <div className="sc-readonly-notice">
                        <Globe size={14} />
                        <span>You have read-only access. Contact your Executive or Master Admin to request changes.</span>
                      </div>
                    )}
                  </div>
                 ) : (
                  <p className="sc-empty">Unable to load company data{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}. You may not be assigned to a company.</p>
                )}
              </div>
            )}

            {activeTab === 'attendance-settings' && isExecutive && (
              <div className="settings-section">
                <h3>Attendance Settings</h3>
                <p className="section-description">
                  Configure grace periods, missed punch detection, and auto-approval rules for your company.
                </p>
                {attendanceSettingsLoading ? (
                  <div className="sc-loading"><Loader2 size={16} className="animate-spin" /> Loading attendance settings...</div>
                ) : (
                  <AttendanceSettingsForm
                    settings={attendanceSettings}
                    companyId={effectiveCompanyId || user?.companyId || ''}
                    onSaved={() => setSuccess('Attendance settings saved successfully.')}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AttendanceSettingsForm({ settings, companyId, onSaved }: {
  settings: { gracePeriodMinutes: number; missedPunchThresholdMinutes: number; autoApprovalEnabled: boolean }
  companyId: string
  onSaved: () => void
}) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setForm(settings) }, [settings])

  const handleSave = async () => {
    if (!companyId) return
    setSaving(true); setError(null)
    try {
      const { saveCompanySettings } = await import('../services/shiftService')
      await saveCompanySettings({ companyId, ...form })
      onSaved()
    } catch (err: any) {
      setError(err.message || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sc-company-settings" style={{ maxWidth: 500 }}>
      <div className="form-grid">
        <div className="form-group">
          <label>Grace Period (minutes)</label>
          <input
            type="number" min={0} max={120}
            value={form.gracePeriodMinutes}
            onChange={e => setForm(f => ({ ...f, gracePeriodMinutes: parseInt(e.target.value) || 0 }))}
          />
          <span className="ep-field-hint">Extra time allowed after shift start before marking late.</span>
        </div>
        <div className="form-group">
          <label>Missed Punch Threshold (minutes)</label>
          <input
            type="number" min={0} max={240}
            value={form.missedPunchThresholdMinutes}
            onChange={e => setForm(f => ({ ...f, missedPunchThresholdMinutes: parseInt(e.target.value) || 0 }))}
          />
          <span className="ep-field-hint">Minutes after shift end before a missing checkout is flagged.</span>
        </div>
        <div className="form-group">
          <label>Auto-approval</label>
          <select
            value={form.autoApprovalEnabled ? 'true' : 'false'}
            onChange={e => setForm(f => ({ ...f, autoApprovalEnabled: e.target.value === 'true' }))}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
          <span className="ep-field-hint">Automatically approve attendance when check-in and check-out are valid.</span>
        </div>
      </div>

      {error && <div className="settings-error"><AlertCircle size={14} /> {error}</div>}

      <div className="settings-actions">
        <button className="btn-primary" onClick={handleSave} disabled={saving || !companyId}>
          <Save size={16} /> {saving ? 'Saving...' : 'Save Attendance Settings'}
        </button>
      </div>
    </div>
  )
}
