import { useState, useEffect, useMemo } from 'react'
import { redactPAN } from '../../services/redactSensitive'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Building2, Mail, Phone, Calendar, MapPin, ArrowLeft,
  Briefcase, Shield, Banknote, FileText, Package, ScrollText,
  Download, Edit, Loader2, ChevronRight, User as UserIcon,
  Plus, Trash2, Link, X, Star, CheckCircle2, Clock, AlertTriangle,
  DollarSign, EyeOff
} from 'lucide-react'
import { Header } from '../../components/Header'
import { Modal } from '../../components/Modal'
import { useAuth } from '../../context/AuthContext'
import { getEmployeeBySlug, updateEmployee } from '../../services/employeeService'
import { getAllCompanies } from '../../services/companyService'
import { getAllUsers } from '../../services/authService'
import { getBankAccounts, addBankAccount, updateBankAccount, deleteBankAccount } from '../../services/bankAccountService'
import { getDocuments, addDocument, deleteDocument } from '../../services/documentService'
import { getContracts, addContract, updateContract, deleteContract } from '../../services/contractService'
import { getLeaveRequestsByUser, computeLeaveBalance, resolveEmployeeLeaveEntitlements } from '../../services/leaveService'
import { resolveEmployeeLeavePolicy } from '../../services/leavePolicyService'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../../config/firebase'
import { isDate } from '../../utils/dateUtils'
import type { Employee, Company, User } from '../../types/user'
import type { BankAccount, EmployeeDocument, EmployeeContract } from '../../types/employeeProfile'
import './EmployeeProfile.css'

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="ep-stat-card">
      <div className="ep-stat-icon" style={{ background: `${color}15`, color }}>
        <Icon size={20} />
      </div>
      <div className="ep-stat-info">
        <span className="ep-stat-label">{label}</span>
        <strong className="ep-stat-value">{value}</strong>
      </div>
    </div>
  )
}

function SectionCard({ title, icon: Icon, children, defaultOpen, onAdd, extra }: { title: string; icon: any; children: React.ReactNode; defaultOpen?: boolean; onAdd?: () => void; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? true)
  return (
    <div className="ep-section">
      <div className="ep-section-header" onClick={() => setOpen(!open)}>
        <div className="ep-section-title">
          <Icon size={18} color="#f97316" />
          <h3>{title}</h3>
        </div>
        <div className="ep-section-actions">
          {extra}
          {onAdd && (
            <button className="ep-add-btn" onClick={(e) => { e.stopPropagation(); onAdd() }}>
              <Plus size={14} /> Add
            </button>
          )}
          <ChevronRight size={16} className={`ep-chevron${open ? ' open' : ''}`} />
        </div>
      </div>
      {open && <div className="ep-section-body">{children}</div>}
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: string | number | undefined | null }) {
  return (
    <div className="ep-field">
      <span className="ep-field-label">{label}</span>
      <span className="ep-field-value">{value ?? '-'}</span>
    </div>
  )
}

function maskAccountNumber(num: string): string {
  if (num.length <= 4) return num
  return '*'.repeat(num.length - 4) + num.slice(-4)
}

// Safely format a Date or a Firestore Timestamp to a localized date string.
// Renders a raw object (e.g. {seconds, nanoseconds}) would crash React (#31).
const fmtDate = (value: unknown, withTime = false): string | null => {
  if (!value) return null
  let d: Date | null = null
  if (isDate(value)) d = value
  else if (typeof (value as any)?.toDate === 'function') {
    const t = (value as any).toDate()
    if (!isNaN(t?.getTime?.())) d = t
  } else if (typeof value === 'string' || typeof value === 'number') {
    const t = new Date(value)
    if (!isNaN(t.getTime())) d = t
  }
  if (!d) return null
  return d.toLocaleDateString('en-IN', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' })
}

const ASSET_STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  Available: { bg: '#dcfce7', color: '#16a34a' },
  Assigned: { bg: '#dbeafe', color: '#2563eb' },
  'In Repair': { bg: '#ffedd5', color: '#f97316' },
  Damaged: { bg: '#fee2e2', color: '#ef4444' },
  Returned: { bg: '#f3f4f6', color: '#6b7280' },
  Lost: { bg: '#fce7f3', color: '#db2777' },
}

const CONTRACT_STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  Active: { bg: '#dcfce7', color: '#16a34a' },
  Expired: { bg: '#f3f4f6', color: '#6b7280' },
  Terminated: { bg: '#fee2e2', color: '#ef4444' },
}

export function EmployeeProfile() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [userAccount, setUserAccount] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [documents, setDocuments] = useState<EmployeeDocument[]>([])
  const [contracts, setContracts] = useState<EmployeeContract[]>([])
  const [assets, setAssets] = useState<any[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [leaveBalance, setLeaveBalance] = useState<Record<string, { allowance: number; used: number; available: number; pending?: number; monthly?: number }> | null>(null)

  const [showBankModal, setShowBankModal] = useState(false)
  const [editingBank, setEditingBank] = useState<BankAccount | null>(null)
  const [showDocModal, setShowDocModal] = useState(false)
  const [showContractModal, setShowContractModal] = useState(false)
  const [editingContract, setEditingContract] = useState<EmployeeContract | null>(null)
  const [savingShift, setSavingShift] = useState(false)

  const canViewSalary = useMemo(() => {
    if (user?.role === 'master-admin') return true
    if (user?.role === 'executive') {
      const assignedIds = (user as any).assignedCompanyIds || []
      return assignedIds.includes(employee?.companyId)
    }
    return false
  }, [user, employee])

  useEffect(() => { if (slug) loadData() }, [slug])

  const loadData = async () => {
    try {
      setLoading(true)
      const emp = await getEmployeeBySlug(slug || '')
      setEmployee(emp)
      if (!emp) { setLoading(false); return }

      const [companies, users] = await Promise.all([
        getAllCompanies().catch(() => [] as Company[]),
        getAllUsers().catch(() => [] as User[]),
      ])
      setUserAccount(users.find(u => u.id === emp.userId) || null)
      setCompany(companies.find(c => c.id === emp.companyId) || null)
      setAllUsers(users)

      const [bankRes, docsRes, contractsRes, assetRes] = await Promise.all([
        getBankAccounts(emp.id).catch(() => []),
        getDocuments(emp.id).catch(() => []),
        getContracts(emp.id).catch(() => []),
        (emp.userId
          ? getDocs(query(collection(db, 'assets'), where('assignedTo', '==', emp.userId))).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })))
          : Promise.resolve([])
        ).catch(() => []),
      ])
      setBankAccounts(bankRes)
      setDocuments(docsRes)
      setContracts(contractsRes)
      setAssets(assetRes)

      if (emp.userId) {
        try {
          const leaves = await getLeaveRequestsByUser(emp.userId).catch(() => [])
          const comp = companies.find(c => c.id === emp.companyId) || null
          const entitlements = resolveEmployeeLeaveEntitlements(emp)
          if (entitlements) {
            setLeaveBalance(computeLeaveBalance(entitlements.yearly, leaves, emp.userId, new Date().getFullYear(), emp.joinDate, entitlements.config, true))
          } else {
            const resolved = await resolveEmployeeLeavePolicy(emp.companyId || '', (emp as any).leavePolicyId, comp?.name)
            setLeaveBalance(computeLeaveBalance(resolved.allowances, leaves, emp.userId, new Date().getFullYear(), emp.joinDate, resolved.config))
          }
        } catch (le) {
          console.error('Failed to load leave balance:', le)
        }
      }
    } catch (err) {
      console.error('Failed to load employee profile:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAddBank = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!employee) return
    const form = new FormData(e.currentTarget)
    const data = {
      accountHolderName: form.get('accountHolderName') as string,
      bankName: form.get('bankName') as string,
      accountNumber: form.get('accountNumber') as string,
      ifscCode: form.get('ifscCode') as string,
      panNumber: form.get('panNumber') as string,
      upiId: form.get('upiId') as string || '',
      isDefault: form.get('isDefault') === 'on',
    }
    if (editingBank) {
      await updateBankAccount(employee.id, editingBank.id, data)
    } else {
      await addBankAccount(employee.id, data)
    }
    setShowBankModal(false)
    setEditingBank(null)
    setBankAccounts(await getBankAccounts(employee.id).catch(() => []))
  }

  const handleDeleteBank = async (accountId: string) => {
    if (!employee) return
    await deleteBankAccount(employee.id, accountId)
    setBankAccounts(await getBankAccounts(employee.id).catch(() => []))
  }

  const handleAddDoc = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!employee || !user) return
    const form = new FormData(e.currentTarget)
    await addDocument(employee.id, {
      name: form.get('name') as string,
      category: form.get('category') as any || 'Other',
      fileUrl: form.get('fileUrl') as string,
      fileSize: 0,
      mimeType: '',
    }, user.id)
    setShowDocModal(false)
    setDocuments(await getDocuments(employee.id).catch(() => []))
  }

  const handleDeleteDoc = async (docId: string) => {
    if (!employee) return
    await deleteDocument(employee.id, docId)
    setDocuments(await getDocuments(employee.id).catch(() => []))
  }

  const handleAddContract = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!employee) return
    const form = new FormData(e.currentTarget)
    const data = {
      type: form.get('type') as any || 'Full-time',
      startDate: new Date(form.get('startDate') as string),
      endDate: form.get('endDate') ? new Date(form.get('endDate') as string) : undefined,
      status: form.get('status') as any || 'Active',
      documentUrl: form.get('documentUrl') as string || '',
      salary: form.get('salary') ? Number(form.get('salary')) : undefined,
      notes: form.get('notes') as string || '',
    }
    if (editingContract) {
      await updateContract(employee.id, editingContract.id, data)
    } else {
      await addContract(employee.id, data)
    }
    setShowContractModal(false)
    setEditingContract(null)
    setContracts(await getContracts(employee.id).catch(() => []))
  }

  const handleDeleteContract = async (contractId: string) => {
    if (!employee) return
    await deleteContract(employee.id, contractId)
    setContracts(await getContracts(employee.id).catch(() => []))
  }

  const handleSaveShift = async (field: 'shiftStart' | 'shiftEnd' | 'shiftType', value: string) => {
    if (!employee || !employee.id || savingShift) return
    setSavingShift(true)
    try {
      const updates: any = {}
      updates[field] = value
      await updateEmployee(employee.id, updates)
      setEmployee(prev => prev ? { ...prev, ...updates } : prev)
    } catch (err) {
      console.error('Failed to save shift setting:', err)
    } finally {
      setSavingShift(false)
    }
  }

  const SHIFT_TYPE_OPTIONS = ['Morning', 'Afternoon', 'Night', 'Custom'] as const

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Employee Profile" />
        <div className="page-content">
          <div className="ep-loading">
            <Loader2 size={32} className="animate-spin" />
            <p>Loading profile...</p>
          </div>
        </div>
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="page-container">
        <Header title="Employee Profile" />
        <div className="page-content">
          <div className="ep-loading">
            <p>Employee not found</p>
            <button className="btn-primary" onClick={() => navigate('/employees')}>Back to Employees</button>
          </div>
        </div>
      </div>
    )
  }

  const statusColors: Record<string, { bg: string; text: string }> = {
    Active: { bg: '#dcfce7', text: '#16a34a' },
    Inactive: { bg: '#fee2e2', text: '#ef4444' },
    'On Leave': { bg: '#ffedd5', text: '#f97316' },
  }
  const sc = statusColors[employee.status] || { bg: '#f3f4f6', text: '#6b7280' }

  return (
    <div className="page-container">
      <Header title="Employee Profile" />
      <div className="page-content">

        {/* Breadcrumb */}
        <div className="ep-breadcrumb">
          <button className="ep-back-btn" onClick={() => navigate('/employees')}>
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>
          <span className="ep-breadcrumb-sep">/</span>
          <span>Employees</span>
          <span className="ep-breadcrumb-sep">/</span>
          <span className="ep-breadcrumb-current">{employee.name}</span>
        </div>

        {/* Profile Header */}
        <div className="ep-header">
          <div className="ep-header-info">
            <div className="ep-header-top">
              <h1>{employee.name}</h1>
              <span className="ep-status-badge" style={{ background: sc.bg, color: sc.text }}>{employee.status}</span>
            </div>
            <p className="ep-designation">{employee.designation}</p>
            <p className="ep-meta">
              {company?.name && <><Building2 size={14} /> {company.name} &middot; </>}
              <Briefcase size={14} /> {employee.department}
              {employee.employmentType && <> &middot; {employee.employmentType}</>}
            </p>
          </div>
          <button className="ep-edit-btn" onClick={() => navigate('/employees')}>
            <Edit size={16} />
            <span>Edit</span>
          </button>
        </div>

        {/* Stats Row */}
        <div className="ep-stats-row">
          <StatCard icon={Calendar} label="Joined" value={fmtDate(employee.joinDate) ?? '-'} color="#f97316" />
          <StatCard icon={Mail} label="Email" value={employee.email} color="#10b981" />
          <StatCard icon={Phone} label="Phone" value={employee.phone || '-'} color="#f59e0b" />
          <StatCard icon={MapPin} label="Address" value={employee.address || '-'} color="#8b5cf6" />
        </div>

        {/* Sections */}
        <div className="ep-sections">

          {/* === PERSONAL INFORMATION === */}
          <SectionCard title="Personal Information" icon={UserIcon} defaultOpen>
            <div className="ep-fields-grid">
              <FieldRow label="Full Name" value={employee.name} />
              <FieldRow label="Email" value={employee.email} />
              <FieldRow label="Phone" value={employee.phone} />
              <FieldRow label="Address" value={employee.address} />
              <FieldRow label="Birth Date" value={fmtDate(employee.birthDate) ?? '-'} />
              <FieldRow label="Emergency Contact" value={employee.emergencyContact} />
            </div>
          </SectionCard>

          {/* === EMPLOYMENT DETAILS === */}
          <SectionCard title="Employment Details" icon={Briefcase} defaultOpen>
            <div className="ep-fields-grid">
              <FieldRow label="Employee ID" value={employee.employeeId} />
              <FieldRow label="Company" value={company?.name} />
              <FieldRow label="Department" value={employee.department} />
              <FieldRow label="Designation" value={employee.designation} />
              <FieldRow label="Join Date" value={fmtDate(employee.joinDate) ?? '-'} />
              <FieldRow label="Employment Type" value={employee.employmentType} />
              <FieldRow label="Status" value={employee.status} />
              <FieldRow label="Salary" value={employee.salary ? `$${employee.salary.toLocaleString()}` : '-'} />
              {canViewSalary && <FieldRow label="Monthly Gross Salary" value={employee.monthlyGrossSalary ? `$${employee.monthlyGrossSalary.toFixed(2)}` : '-'} />}
              {canViewSalary && employee.salaryEffectiveDate && <FieldRow label="Salary Effective Date" value={fmtDate(employee.salaryEffectiveDate) ?? '-'} />}
              <FieldRow label="Role" value={userAccount?.role ? userAccount.role.replace('-', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()) : '-'} />
            </div>
          </SectionCard>

          {/* === BANK INFORMATION === */}
          <SectionCard
            title="Bank Information"
            icon={Banknote}
            defaultOpen={false}
            onAdd={() => { setEditingBank(null); setShowBankModal(true) }}
          >
            {bankAccounts.length === 0 ? (
              <div className="ep-empty-section"><Banknote size={24} className="ep-empty-icon" /><p>No bank information available</p></div>
            ) : (
              <div className="ep-bank-list">
                {bankAccounts.map(acct => (
                  <div key={acct.id} className="ep-bank-item">
                    <div className="ep-bank-info">
                      <div className="ep-bank-info-top">
                        <strong>{acct.bankName}</strong>
                        {acct.isDefault && <span className="ep-default-badge"><Star size={10} /> Default</span>}
                      </div>
                      <span>{acct.accountHolderName} &middot; {maskAccountNumber(acct.accountNumber)}</span>
                      <span className="ep-bank-meta">IFSC: {acct.ifscCode} &middot; PAN: {redactPAN(acct.panNumber)}{acct.upiId ? ` &middot; UPI: ${acct.upiId}` : ''}</span>
                    </div>
                    <div className="ep-bank-actions">
                      <button className="ep-icon-btn" onClick={() => { setEditingBank(acct); setShowBankModal(true) }}>
                        <Edit size={14} />
                      </button>
                      <button className="ep-icon-btn ep-icon-btn-danger" onClick={() => handleDeleteBank(acct.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* === DOCUMENTS === */}
          <SectionCard
            title="Documents"
            icon={FileText}
            defaultOpen={false}
            onAdd={() => setShowDocModal(true)}
          >
            {documents.length === 0 ? (
              <div className="ep-empty-section"><FileText size={24} className="ep-empty-icon" /><p>No documents uploaded</p></div>
            ) : (
              <div className="ep-docs-list">
                {documents.map(doc => (
                  <div key={doc.id} className="ep-doc-item">
                    <div className="ep-doc-info">
                      <FileText size={18} color="#f97316" />
                      <div>
                        <strong>{doc.name}</strong>
                        <span>{doc.category} &middot; {fmtDate(doc.uploadedAt) ?? '-'}</span>
                      </div>
                    </div>
                    <div className="ep-doc-actions">
                      {doc.fileUrl && (
                        <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="ep-doc-download">
                          <Link size={14} />
                        </a>
                      )}
                      <button className="ep-icon-btn ep-icon-btn-danger" onClick={() => handleDeleteDoc(doc.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* === ASSIGNED ASSETS === */}
          <SectionCard title="Assigned Assets" icon={Package} defaultOpen={false}>
            {assets.length === 0 ? (
              <div className="ep-empty-section"><Package size={24} className="ep-empty-icon" /><p>No assets assigned</p></div>
            ) : (
              <div className="ep-assets-list">
                {assets.map((asset: any) => {
                  const as = ASSET_STATUS_STYLES[asset.status] || { bg: '#f3f4f6', color: '#6b7280' }
                  return (
                    <div key={asset.id} className="ep-asset-item">
                      <div className="ep-asset-icon" style={{ background: '#fff7ed', color: '#f97316' }}>
                        <Package size={18} />
                      </div>
                      <div className="ep-asset-info">
                        <strong>{asset.name}</strong>
                        <span>{asset.category}{asset.serialNumber ? ` \u00b7 ${asset.serialNumber}` : ''}</span>
                      </div>
                      <span className="ep-asset-status" style={{ background: as.bg, color: as.color }}>{asset.status}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>

          {/* === SHIFT CONFIGURATION === */}
          <SectionCard title="Shift Configuration" icon={Clock} defaultOpen={false}>
            {employee && (
              <div className="ep-field-grid">
                <div className="ep-field">
                  <label className="ep-field-label">Shift Type</label>
                  <select
                    value={employee.shiftType || 'Morning'}
                    onChange={e => handleSaveShift('shiftType', e.target.value)}
                    disabled={savingShift}
                    className="ep-field-select"
                  >
                    {SHIFT_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="ep-field">
                  <label className="ep-field-label">Shift Start Time</label>
                  <input
                    type="time"
                    value={employee.shiftStart || '09:00'}
                    onChange={e => handleSaveShift('shiftStart', e.target.value)}
                    disabled={savingShift}
                    className="ep-field-input"
                  />
                </div>
                <div className="ep-field">
                  <label className="ep-field-label">Shift End Time</label>
                  <input
                    type="time"
                    value={employee.shiftEnd || '18:00'}
                    onChange={e => handleSaveShift('shiftEnd', e.target.value)}
                    disabled={savingShift}
                    className="ep-field-input"
                  />
                </div>
                {savingShift && (
                  <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 }}>
                    <Loader2 size={14} className="animate-spin" /> Saving...
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* === CONTRACTS === */}
          <SectionCard
            title="Contracts"
            icon={ScrollText}
            defaultOpen={false}
            onAdd={() => { setEditingContract(null); setShowContractModal(true) }}
          >
            {contracts.length === 0 ? (
              <div className="ep-empty-section"><ScrollText size={24} className="ep-empty-icon" /><p>No contracts available</p></div>
            ) : (
              <div className="ep-contracts-list">
                {contracts.map(ct => {
                  const cs = CONTRACT_STATUS_STYLES[ct.status] || { bg: '#f3f4f6', color: '#6b7280' }
                  return (
                    <div key={ct.id} className="ep-contract-item">
                      <div className="ep-contract-info">
                        <ScrollText size={18} color="#f97316" />
                        <div>
                          <strong>{ct.type}</strong>
                          <span>{fmtDate(ct.startDate)}{ct.endDate ? ` - ${fmtDate(ct.endDate)}` : ''}{ct.salary ? ` \u00b7 $${ct.salary.toLocaleString()}` : ''}</span>
                        </div>
                      </div>
                      <div className="ep-contract-actions">
                        <span className="ep-contract-status" style={{ background: cs.bg, color: cs.color }}>{ct.status}</span>
                        <button className="ep-icon-btn" onClick={() => { setEditingContract(ct); setShowContractModal(true) }}>
                          <Edit size={14} />
                        </button>
                        <button className="ep-icon-btn ep-icon-btn-danger" onClick={() => handleDeleteContract(ct.id)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>

          {/* === LEAVE BALANCE === */}
          <SectionCard
            title="Leave Balance"
            icon={Calendar}
            defaultOpen={false}
          >
            {!leaveBalance ? (
              <div className="ep-empty-section"><Calendar size={24} className="ep-empty-icon" /><p>Leave balance unavailable</p></div>
            ) : (
              <div className="ep-fields-grid">
                {Object.keys(leaveBalance).map((type) => {
                  const e = leaveBalance[type]
                  const low = e.available <= 2 && e.allowance > 0
                  const pending = e.pending || 0
                  return (
                    <div className="ep-field" key={type}>
                      <span className="ep-field-label">{type} Leave</span>
                      <span className="ep-field-value">
                        <strong style={{ color: low ? '#ef4444' : '#111827' }}>{e.available}</strong>
                        <span style={{ color: '#9ca3af', fontSize: 12 }}> available</span>
                        <span style={{ color: '#9ca3af', fontSize: 12, display: 'block' }}>
                          {e.monthly !== undefined && e.monthly > 0 ? `${e.monthly}/mo · ` : ''}{e.used} used / {e.allowance} yearly
                        </span>
                        {pending > 0 && <span style={{ color: '#6366f1', fontSize: 11, display: 'block' }}>{pending} pending</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      {/* === BANK ACCOUNT MODAL === */}
      <Modal
        isOpen={showBankModal}
        onClose={() => { setShowBankModal(false); setEditingBank(null) }}
        title={editingBank ? 'Edit Bank Account' : 'Add Bank Account'}
      >
        <form onSubmit={handleAddBank} className="ep-form">
          <div className="ep-form-row">
            <label>Account Holder Name <span className="required">*</span></label>
            <input name="accountHolderName" defaultValue={editingBank?.accountHolderName || employee?.name || ''} required />
          </div>
          <div className="ep-form-row">
            <label>Bank Name <span className="required">*</span></label>
            <input name="bankName" defaultValue={editingBank?.bankName || ''} required />
          </div>
          <div className="ep-form-row">
            <label>Account Number <span className="required">*</span></label>
            <input name="accountNumber" defaultValue={editingBank?.accountNumber || ''} required />
          </div>
          <div className="ep-form-row ep-form-row-half">
            <div>
              <label>IFSC Code <span className="required">*</span></label>
              <input name="ifscCode" defaultValue={editingBank?.ifscCode || ''} required />
            </div>
            <div>
              <label>PAN Number <span className="required">*</span></label>
              <input name="panNumber" defaultValue={editingBank?.panNumber || ''} required />
            </div>
          </div>
          <div className="ep-form-row">
            <label>UPI ID</label>
            <input name="upiId" defaultValue={editingBank?.upiId || ''} />
          </div>
          <div className="ep-form-row ep-form-check">
            <label>
              <input type="checkbox" name="isDefault" defaultChecked={editingBank?.isDefault || false} />
              Set as default account
            </label>
          </div>
          <div className="ep-form-actions">
            <button type="button" className="btn-secondary" onClick={() => { setShowBankModal(false); setEditingBank(null) }}>Cancel</button>
            <button type="submit" className="btn-primary">{editingBank ? 'Update' : 'Add'} Account</button>
          </div>
        </form>
      </Modal>

      {/* === DOCUMENT MODAL === */}
      <Modal
        isOpen={showDocModal}
        onClose={() => setShowDocModal(false)}
        title="Add Document"
      >
        <form onSubmit={handleAddDoc} className="ep-form">
          <div className="ep-form-row">
            <label>Document Name <span className="required">*</span></label>
            <input name="name" required />
          </div>
          <div className="ep-form-row">
            <label>Category <span className="required">*</span></label>
            <select name="category" required>
              <option value="Identity">Identity</option>
              <option value="Education">Education</option>
              <option value="Experience">Experience</option>
              <option value="Bank">Bank</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div className="ep-form-row">
            <label>File URL <span className="required">*</span></label>
            <input name="fileUrl" type="url" placeholder="https://..." required />
          </div>
          <div className="ep-form-actions">
            <button type="button" className="btn-secondary" onClick={() => setShowDocModal(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Add Document</button>
          </div>
        </form>
      </Modal>

      {/* === CONTRACT MODAL === */}
      <Modal
        isOpen={showContractModal}
        onClose={() => { setShowContractModal(false); setEditingContract(null) }}
        title={editingContract ? 'Edit Contract' : 'Add Contract'}
      >
        <form onSubmit={handleAddContract} className="ep-form">
          <div className="ep-form-row">
            <label>Type <span className="required">*</span></label>
            <select name="type" defaultValue={editingContract?.type || 'Full-time'} required>
              <option value="Full-time">Full-time</option>
              <option value="Part-time">Part-time</option>
              <option value="Contract">Contract</option>
              <option value="Intern">Intern</option>
            </select>
          </div>
          <div className="ep-form-row ep-form-row-half">
            <div>
              <label>Start Date <span className="required">*</span></label>
              <input name="startDate" type="date" defaultValue={editingContract?.startDate && isDate(editingContract.startDate) ? editingContract.startDate.toISOString().split('T')[0] : ''} required />
            </div>
            <div>
              <label>End Date</label>
              <input name="endDate" type="date" defaultValue={editingContract?.endDate && isDate(editingContract.endDate) ? editingContract.endDate.toISOString().split('T')[0] : ''} />
            </div>
          </div>
          <div className="ep-form-row ep-form-row-half">
            <div>
              <label>Status <span className="required">*</span></label>
              <select name="status" defaultValue={editingContract?.status || 'Active'} required>
                <option value="Active">Active</option>
                <option value="Expired">Expired</option>
                <option value="Terminated">Terminated</option>
              </select>
            </div>
            <div>
              <label>Salary (annual)</label>
              <input name="salary" type="number" defaultValue={editingContract?.salary || ''} />
            </div>
          </div>
          <div className="ep-form-row">
            <label>Document URL</label>
            <input name="documentUrl" defaultValue={editingContract?.documentUrl || ''} placeholder="https://..." />
          </div>
          <div className="ep-form-row">
            <label>Notes</label>
            <textarea name="notes" defaultValue={editingContract?.notes || ''} rows={3} />
          </div>
          <div className="ep-form-actions">
            <button type="button" className="btn-secondary" onClick={() => { setShowContractModal(false); setEditingContract(null) }}>Cancel</button>
            <button type="submit" className="btn-primary">{editingContract ? 'Update' : 'Add'} Contract</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
