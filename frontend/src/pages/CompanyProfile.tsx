import { useState, useEffect, useRef } from 'react'
import { Building2, Mail, Phone, Globe, MapPin, Calendar, Users, Edit, Loader2, FileText, Settings, X, Trash2, CheckCircle, Upload, Plus, Star, BadgeCheck } from 'lucide-react'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { getCompanyById } from '../services/companyService'
import { getEmployeeStats } from '../services/employeeService'
import { getLeavePoliciesByCompany, createLeavePolicy, updateLeavePolicy, deleteLeavePolicy, setDefaultLeavePolicy, ensureDefaultLeavePolicy, DEFAULT_LEAVE_TYPE_POLICY } from '../services/leavePolicyService'
import { LEAVE_TYPES } from '../services/leaveService'
import type { Company, LeavePolicy, LeaveTypePolicy } from '../types/user'
import './Employees.css'
import './Assets.css'

const DAYS = ['Monday - Friday', 'Monday - Saturday', '5 Days a Week', '6 Days a Week']
const HOURS = ['9:00 AM - 6:00 PM', '8:00 AM - 5:00 PM', '10:00 AM - 7:00 PM', '9:00 AM - 5:00 PM']
const ZONES = ['IST (UTC +5:30)', 'EST (UTC -5:00)', 'PST (UTC -8:00)', 'GMT (UTC +0:00)']

interface DocState {
  status: 'Pending' | 'Uploading' | 'Uploaded'
  fileName: string
  progress: number
}

export function CompanyProfile() {
  const { user } = useAuth()
  const [company, setCompany] = useState<Company | null>(null)
  const [empCount, setEmpCount] = useState(0)
  const [totalPayroll, setTotalPayroll] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const docRefs = useRef<(HTMLInputElement | null)[]>([])

  const [formData, setFormData] = useState({ name: '', adminEmail: '', phone: '', website: '', address: '' })
  const [settingsData, setSettingsData] = useState({ workingDays: DAYS[0], workHours: HOURS[0], timeZone: ZONES[0], currency: 'INR (₹)' })
  const [opData, setOpData] = useState({ averageSalary: 0, mandatoryAttendanceDays: 22 })
  const DEFAULT_LEAVE_ALLOWANCES: Record<string, number> = { Casual: 12, Sick: 12, Earned: 15, Unpaid: 0, Maternity: 180, Paternity: 5 }
  const [leaveData, setLeaveData] = useState<Record<string, number>>({ ...DEFAULT_LEAVE_ALLOWANCES })
  const [policies, setPolicies] = useState<LeavePolicy[]>([])
  const [policyModalOpen, setPolicyModalOpen] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<LeavePolicy | null>(null)
  const [policyName, setPolicyName] = useState('')
  const [policyDesc, setPolicyDesc] = useState('')
  const [policyTypes, setPolicyTypes] = useState<Record<string, LeaveTypePolicy>>({})
  const [policyBusy, setPolicyBusy] = useState(false)
  const [policyMsg, setPolicyMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [documents, setDocuments] = useState<DocState[]>([
    { status: 'Pending', fileName: '', progress: 0 },
    { status: 'Pending', fileName: '', progress: 0 },
    { status: 'Pending', fileName: '', progress: 0 },
  ])

  useEffect(() => {
    loadData()
  }, [user?.companyId])

  const loadData = async () => {
    try {
      setLoading(true)
      if (!user?.companyId) return
      const [comp, stats] = await Promise.all([
        getCompanyById(user.companyId).catch(() => null),
        getEmployeeStats().catch(() => ({ total: 0 })),
      ])
      setCompany(comp)
      setEmpCount(stats.total || 0)
      // Calculate total monthly payroll
      const { getAllEmployees } = await import('../services/employeeService')
      const allEmp = await getAllEmployees().catch(() => [])
      const companyEmps = allEmp.filter(e => e.companyId === user.companyId)
      setTotalPayroll(companyEmps.reduce((sum, e) => sum + (e.monthlyGrossSalary || 0), 0))
      if (comp) {
        setFormData({ name: comp.name, adminEmail: comp.adminEmail, phone: comp.phone || '', website: comp.website || '', address: comp.address || '' })
        setSettingsData({
          workingDays: comp.settings?.workingDays || DAYS[0],
          workHours: comp.settings?.workHours || HOURS[0],
          timeZone: comp.settings?.timeZone || ZONES[0],
          currency: comp.settings?.currency || 'INR (₹)'
        })
        setOpData({
          averageSalary: comp.averageSalary || 0,
          mandatoryAttendanceDays: comp.mandatoryAttendanceDays || 22
        })
        setLeaveData({ ...DEFAULT_LEAVE_ALLOWANCES, ...(comp.leaveAllowances || {}) })
        await loadPolicies(comp)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const loadPolicies = async (comp: Company) => {
    try {
      await ensureDefaultLeavePolicy(comp.id, comp.name)
      const list = await getLeavePoliciesByCompany(comp.id)
      const def = list.find(p => p.isDefault) || list[0]
      if (def) {
        const { resolveEmployeeLeavePolicy } = await import('../services/leavePolicyService')
        const resolved = await resolveEmployeeLeavePolicy(comp.id, def.id, comp.name)
        setLeaveData(resolved.allowances)
      }
      setPolicies(list)
    } catch (err) {
      console.error('Failed to load leave policies', err)
    }
  }

  const freshPolicyTypes = (): Record<string, LeaveTypePolicy> => {
    const out: Record<string, LeaveTypePolicy> = {}
    for (const t of LEAVE_TYPES) {
      out[t] = { ...DEFAULT_LEAVE_TYPE_POLICY[t] }
    }
    return out
  }

  const openAddPolicy = () => {
    setEditingPolicy(null)
    setPolicyName('')
    setPolicyDesc('')
    setPolicyTypes(freshPolicyTypes())
    setPolicyMsg(null)
    setPolicyModalOpen(true)
  }

  const openEditPolicy = (p: LeavePolicy) => {
    setEditingPolicy(p)
    setPolicyName(p.name)
    setPolicyDesc(p.description || '')
    const out: Record<string, LeaveTypePolicy> = {}
    for (const t of LEAVE_TYPES) {
      out[t] = { ...DEFAULT_LEAVE_TYPE_POLICY[t], ...(p.types?.[t] || {}) }
    }
    setPolicyTypes(out)
    setPolicyMsg(null)
    setPolicyModalOpen(true)
  }

  const savePolicy = async () => {
    if (!company) return
    setPolicyBusy(true)
    setPolicyMsg(null)
    try {
      const name = policyName.trim() || 'Untitled Policy'
      const allDefaulted = policies.length === 0 || (editingPolicy && policies.every(p => p.id === editingPolicy.id))
      if (editingPolicy) {
        await updateLeavePolicy(editingPolicy.id, { name, description: policyDesc, types: policyTypes })
      } else {
        await createLeavePolicy(company.id, { name, description: policyDesc, types: policyTypes, isDefault: policies.length === 0, createdBy: user?.id, createdByName: user?.name })
      }
      await loadPolicies(company)
      if (allDefaulted) setPolicyMsg({ type: 'success', text: 'Policy saved. It is the company default.' })
      else setPolicyMsg({ type: 'success', text: 'Policy saved.' })
      setPolicyModalOpen(false)
    } catch (err) {
      console.error('Failed to save policy', err)
      setPolicyMsg({ type: 'error', text: 'Could not save policy.' })
    } finally {
      setPolicyBusy(false)
    }
  }

  const handleSetDefault = async (p: LeavePolicy) => {
    if (!company) return
    try {
      await setDefaultLeavePolicy(company.id, p.id)
      await loadPolicies(company)
    } catch (err) {
      console.error('Failed to set default policy', err)
    }
  }

  const handleDeletePolicy = async (p: LeavePolicy) => {
    if (p.isDefault) {
      setPolicyMsg({ type: 'error', text: 'Default policy cannot be deleted. Set another policy as default first.' })
      return
    }
    if (!window.confirm(`Delete leave policy "${p.name}"? Employees assigned to it will fall back to the company default.`)) return
    try {
      await deleteLeavePolicy(p.id)
      if (company) await loadPolicies(company)
    } catch (err) {
      console.error('Failed to delete policy', err)
    }
  }

  const handleSave = async () => {
    if (!company) return
    setCompany(prev => prev ? { ...prev, ...formData, settings: settingsData, ...opData, leaveAllowances: leaveData } : prev)
    setEditing(false)
    try {
      const { updateCompany } = await import('../services/companyService')
      await updateCompany(company.id, {
        name: formData.name,
        adminEmail: formData.adminEmail,
        phone: formData.phone,
        website: formData.website,
        address: formData.address,
        averageSalary: opData.averageSalary,
        mandatoryAttendanceDays: opData.mandatoryAttendanceDays,
        leaveAllowances: leaveData,
        settings: {
          workingDays: settingsData.workingDays,
          workHours: settingsData.workHours,
          timeZone: settingsData.timeZone,
          currency: settingsData.currency,
        },
      })
    } catch (err) {
      console.error('Failed to save company profile', err)
      setEditing(true)
    }
  }

  const handleCancel = () => {
    if (company) {
      setFormData({ name: company.name, adminEmail: company.adminEmail, phone: company.phone || '', website: company.website || '', address: company.address || '' })
      setOpData({ averageSalary: company.averageSalary || 0, mandatoryAttendanceDays: company.mandatoryAttendanceDays || 22 })
      setLeaveData({ ...DEFAULT_LEAVE_ALLOWANCES, ...(company.leaveAllowances || {}) })
    }
    setEditing(false)
  }

  const handleDocSelect = (idx: number, file: File | null) => {
    if (!file) return
    setDocuments(prev => prev.map((d, i) => i === idx ? { ...d, status: 'Uploaded', fileName: file.name, progress: 100 } : d))
  }

  const handleDocRemove = (idx: number) => {
    setDocuments(prev => prev.map((d, i) => i === idx ? { status: 'Pending', fileName: '', progress: 0 } : d))
    if (docRefs.current[idx]) docRefs.current[idx]!.value = ''
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Company Profile" />
        <div className="page-content"><div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading company profile...</p></div></div>
      </div>
    )
  }

  if (!company) {
    return (
      <div className="page-container">
        <Header title="Company Profile" />
        <div className="page-content">
          <div className="loading-container"><p>Company not found. Contact Master Admin.</p></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Company Profile" />
      <div className="page-content">
        <div className="ep-header" style={{ flexWrap: 'wrap', gap: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: 14, background: company.logoColor || '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {company.name?.[0] || 'C'}
          </div>
          <div className="ep-header-info">
            <div className="ep-header-top">
              <h1>{company.name}</h1>
              <span className="emp-status-badge" style={{ background: company.status === 'Active' ? '#dcfce7' : '#fee2e2', color: company.status === 'Active' ? '#16a34a' : '#ef4444' }}>{company.status}</span>
            </div>
            <p className="ep-designation">{company.domain}</p>
            <p className="ep-meta"><Building2 size={14} /> Company Code: {company.code}</p>
          </div>
          {editing ? (
            <div style={{ display: 'flex', gap: 10, marginLeft: 'auto', alignItems: 'center' }}>
              <button className="ep-edit-btn" onClick={handleCancel}>
                <X size={16} /><span>Cancel</span>
              </button>
              <button onClick={handleSave} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 8, padding: '8px 16px', background: '#f97316', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <CheckCircle size={16} /><span>Save Changes</span>
              </button>
            </div>
          ) : (
            <button className="ep-edit-btn" onClick={() => setEditing(true)} style={{ marginLeft: 'auto' }}>
              <Edit size={16} /><span>Edit</span>
            </button>
          )}
        </div>

        <div className="ep-sections">
          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <Building2 size={18} color="#f97316" />
                <h3>Company Details</h3>
              </div>
            </div>
            <div className="ep-section-body">
              <div className="ep-fields-grid">
                <div className="ep-field">
                  <span className="ep-field-label">Company Name</span>
                  {editing ? (
                    <input type="text" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
                  ) : (
                    <span className="ep-field-value">{company.name}</span>
                  )}
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Email</span>
                  {editing ? (
                    <input type="email" value={formData.adminEmail} onChange={e => setFormData(p => ({ ...p, adminEmail: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
                  ) : (
                    <span className="ep-field-value">{company.adminEmail}</span>
                  )}
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Phone</span>
                  {editing ? (
                    <input type="text" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
                  ) : (
                    <span className="ep-field-value">{company.phone || '-'}</span>
                  )}
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Website</span>
                  {editing ? (
                    <input type="text" value={formData.website} onChange={e => setFormData(p => ({ ...p, website: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
                  ) : (
                    <span className="ep-field-value">{company.website || '-'}</span>
                  )}
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Address</span>
                  {editing ? (
                    <input type="text" value={formData.address} onChange={e => setFormData(p => ({ ...p, address: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
                  ) : (
                    <span className="ep-field-value">{company.address || '-'}</span>
                  )}
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Created On</span>
                  <span className="ep-field-value">{company.createdOn ? new Date(company.createdOn).toLocaleDateString() : '-'}</span>
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Employees</span>
                  <span className="ep-field-value">{empCount} Total</span>
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Total Monthly Payroll</span>
                  <span className="ep-field-value">${totalPayroll.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <FileText size={18} color="#f97316" />
                <h3>Documents</h3>
              </div>
            </div>
            <div className="ep-section-body">
              <div className="ep-docs-list">
                {['Registration Certificate', 'Tax Document', 'Company Policy'].map((doc, i) => {
                  const d = documents[i]
                  return (
                    <div key={i} className="ep-doc-item">
                      <div className="ep-doc-info">
                        <FileText size={18} color={d.status === 'Uploaded' ? '#16a34a' : '#f97316'} />
                        <div>
                          <strong>{doc}</strong>
                          <span style={{ color: d.status === 'Uploaded' ? '#16a34a' : d.status === 'Uploading' ? '#f97316' : '#9ca3af', fontWeight: d.status === 'Uploading' ? 600 : 400 }}>
                            {d.status === 'Uploaded' ? `PDF \u00B7 Verified (${d.fileName})` : d.status === 'Uploading' ? `Uploading... (${d.progress}%)` : 'PDF \u00B7 Pending'}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {d.status === 'Uploaded' ? (
                          <button onClick={() => handleDocRemove(i)} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }} title="Remove">
                            <Trash2 size={14} />
                          </button>
                        ) : (
                          <>
                            <button onClick={() => docRefs.current[i]?.click()} className="btn-primary" style={{ padding: '6px 14px', fontSize: 12, opacity: d.status === 'Uploading' ? 0.6 : 1, pointerEvents: d.status === 'Uploading' ? 'none' : 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Upload size={12} />{d.status === 'Uploading' ? 'Uploading' : 'Upload'}
                            </button>
                            <input
                              ref={el => { docRefs.current[i] = el }}
                              type="file"
                              accept=".pdf"
                              style={{ display: 'none' }}
                              onChange={e => handleDocSelect(i, e.target.files?.[0] || null)}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <Settings size={18} color="#f97316" />
                <h3>Company Settings</h3>
              </div>
            </div>
            <div className="ep-section-body">
              <div className="ep-fields-grid">
                <div className="ep-field">
                  <span className="ep-field-label">Working Days</span>
                  {editing ? (
                    <select value={settingsData.workingDays} onChange={e => setSettingsData(p => ({ ...p, workingDays: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', background: '#fff', width: '100%', boxSizing: 'border-box', outline: 'none', cursor: 'pointer' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'}>
                      {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : (
                    <span className="ep-field-value">{settingsData.workingDays}</span>
                  )}
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Work Hours</span>
                  {editing ? (
                    <select value={settingsData.workHours} onChange={e => setSettingsData(p => ({ ...p, workHours: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', background: '#fff', width: '100%', boxSizing: 'border-box', outline: 'none', cursor: 'pointer' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'}>
                      {HOURS.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  ) : (
                    <span className="ep-field-value">{settingsData.workHours}</span>
                  )}
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Time Zone</span>
                  {editing ? (
                    <select value={settingsData.timeZone} onChange={e => setSettingsData(p => ({ ...p, timeZone: e.target.value }))} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', background: '#fff', width: '100%', boxSizing: 'border-box', outline: 'none', cursor: 'pointer' }} onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'}>
                      {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                  ) : (
                    <span className="ep-field-value">{settingsData.timeZone}</span>
                  )}
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Currency</span>
                  <span className="ep-field-value">{settingsData.currency}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <Settings size={18} color="#f97316" />
                <h3>Operational Policies</h3>
              </div>
            </div>
            <div className="ep-section-body">
              <div className="ep-fields-grid">
                <div className="ep-field">
                  <span className="ep-field-label">Average Salary (Monthly)</span>
                  {editing ? (
                    <input type="number" step="0.01" min="0" value={opData.averageSalary}
                      onChange={e => setOpData(p => ({ ...p, averageSalary: parseFloat(e.target.value) || 0 }))}
                      style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
                  ) : (
                    <span className="ep-field-value">{opData.averageSalary > 0 ? `$${opData.averageSalary.toFixed(2)}` : '-'}</span>
                  )}
                </div>
                <div className="ep-field">
                  <span className="ep-field-label">Mandatory Monthly Attendance (Days)</span>
                  {editing ? (
                    <input type="number" min="1" max="31" value={opData.mandatoryAttendanceDays}
                      onChange={e => setOpData(p => ({ ...p, mandatoryAttendanceDays: parseInt(e.target.value) || 22 }))}
                      style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none' }}
                      onFocus={e => e.target.style.borderColor = '#f97316'} onBlur={e => e.target.style.borderColor = '#d1d5db'} />
                  ) : (
                    <span className="ep-field-value">{opData.mandatoryAttendanceDays} days/month</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="ep-section">
            <div className="ep-section-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div className="ep-section-title">
                <Settings size={18} color="#f97316" />
                <h3>Leave Policies</h3>
              </div>
              <button onClick={openAddPolicy} style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 12px', background: '#fff', color: '#111827', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <Plus size={14} /> Add Policy
              </button>
            </div>
            <div className="ep-section-body">
              <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#9ca3af' }}>
                Define named leave policies: days per type, paid/unpaid, and encashable flags. Assign a policy to each employee when you create or edit them.
              </p>
              {policies.length === 0 ? (
                <p style={{ fontSize: 13, color: '#9ca3af' }}>Loading policies...</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {policies.map(p => (
                    <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 14px', background: '#fafafa' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                        <strong style={{ fontSize: 13, color: '#111827' }}>{p.name}</strong>
                        {p.isDefault && (
                          <span style={{ fontSize: 10, background: '#dcfce7', color: '#16a34a', borderRadius: 99, padding: '2px 7px', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <BadgeCheck size={11} /> Default
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                          <button onClick={() => openEditPolicy(p)} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 5, padding: '3px 8px', fontSize: 11, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Edit size={11} /> Edit</button>
                          {!p.isDefault && (
                            <button onClick={() => handleDeletePolicy(p)} style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 5, padding: '3px 8px', fontSize: 11, color: '#ef4444', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Trash2 size={11} /> Delete</button>
                          )}
                          {!p.isDefault && policies.length > 1 && (
                            <button onClick={() => handleSetDefault(p)} style={{ background: 'none', border: '1px solid #fde68a', borderRadius: 5, padding: '3px 8px', fontSize: 11, color: '#92400e', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Star size={11} /> Set default</button>
                          )}
                        </span>
                      </div>
                      {p.description && <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>{p.description}</div>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {LEAVE_TYPES.filter(t => t !== 'Unpaid').map(t => {
                          const cfg = p.types?.[t] || DEFAULT_LEAVE_TYPE_POLICY[t]
                          return (
                            <span key={t} style={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 8px', background: '#fff', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              {t} <strong>{cfg.days}</strong>
                              {!cfg.paid && <span style={{ color: '#ef4444', fontSize: 10 }}>(Unpaid)</span>}
                              {cfg.encashable && <span style={{ color: '#16a34a', fontSize: 10 }}>*</span>}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Policy status toast */}
        {policyMsg && (
          <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,.15)' , background: policyMsg.type === 'success' ? '#dcfce7' : '#fee2e2', color: policyMsg.type === 'success' ? '#166534' : '#991b1b' }}>
            {policyMsg.text}
          </div>
        )}

        {/* Add/Edit Leave Policy Modal */}
        {policyModalOpen && (
          <div className="modal-overlay" onClick={() => setPolicyModalOpen(false)}>
            <div className="modal" style={{ maxWidth: 720, width: '95%', maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{editingPolicy ? 'Edit Leave Policy' : 'Add Leave Policy'}</h3>
                <button onClick={() => setPolicyModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={18} /></button>
              </div>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Policy Name *</label>
                  <input type="text" value={policyName} onChange={e => setPolicyName(e.target.value)} placeholder="e.g. Standard Leave Policy" style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, width: '100%', boxSizing: 'border-box', outline: 'none' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Description</label>
                  <input type="text" value={policyDesc} onChange={e => setPolicyDesc(e.target.value)} placeholder="Optional notes about this policy" style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', fontSize: 14, width: '100%', boxSizing: 'border-box', outline: 'none' }} />
                </div>

                <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Leave Types</div>
                <div style={{ display: 'grid', gridTemplateColumns: '140px 80px 80px 80px', gap: '8px 10px', alignItems: 'center', fontSize: 12, color: '#6b7280' }}>
                  <span style={{ fontWeight: 700, color: '#374151' }}>Type</span>
                  <span style={{ textAlign: 'center', fontWeight: 700, color: '#374151' }}>Days</span>
                  <span style={{ textAlign: 'center', fontWeight: 700, color: '#374151' }}>Paid</span>
                  <span style={{ textAlign: 'center', fontWeight: 700, color: '#374151' }}>Encashable</span>
                </div>
                {LEAVE_TYPES.map(t => {
                  const cur = policyTypes[t] || DEFAULT_LEAVE_TYPE_POLICY[t]
                  return (
                    <div key={t} style={{ display: 'grid', gridTemplateColumns: '140px 80px 80px 80px', gap: '8px 10px', alignItems: 'center', background: '#fafafa', borderRadius: 6, padding: '8px 10px' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{t}</span>
                      <input type="number" min="0" max="365" value={cur.days}
                        onChange={e => setPolicyTypes(p => ({ ...p, [t]: { ...cur, days: parseInt(e.target.value) || 0 } }))}
                        style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 8px', fontSize: 13, textAlign: 'center', width: '100%', boxSizing: 'border-box', outline: 'none' }} />
                      <div style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={cur.paid}
                          onChange={e => setPolicyTypes(p => ({ ...p, [t]: { ...cur, paid: e.target.checked } }))}
                          style={{ cursor: 'pointer' }} />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={cur.encashable}
                          onChange={e => setPolicyTypes(p => ({ ...p, [t]: { ...cur, encashable: e.target.checked } }))}
                          disabled={!cur.paid}
                          title={!cur.paid ? 'Unpaid leaves cannot be encashable' : ''}
                          style={{ cursor: cur.paid ? 'pointer' : 'not-allowed' }} />
                      </div>
                    </div>
                  )
                })}
                {policyMsg?.type === 'error' && <div style={{ fontSize: 12, color: '#ef4444' }}>{policyMsg.text}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setPolicyModalOpen(false)} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 14px', fontSize: 13, background: '#fff', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={savePolicy} disabled={policyBusy || !policyName.trim()} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 600, background: policyBusy || !policyName.trim() ? '#d1d5db' : '#f97316', color: '#fff', cursor: policyBusy || !policyName.trim() ? 'not-allowed' : 'pointer' }}>
                    {policyBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                    {editingPolicy ? 'Update Policy' : 'Create Policy'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
