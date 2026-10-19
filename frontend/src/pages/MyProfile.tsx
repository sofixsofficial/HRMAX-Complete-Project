import { useState, useEffect } from 'react'
import { redactPAN } from '../services/redactSensitive'
import { User, Mail, Phone, MapPin, Calendar, Briefcase, Building2, Shield, Banknote, Package, FileText, ScrollText, Loader2 } from 'lucide-react'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { getEmployeeByUserId } from '../services/employeeService'
import { getAllCompanies } from '../services/companyService'
import { getBankAccounts } from '../services/bankAccountService'
import { getDocuments } from '../services/documentService'
import { getContracts } from '../services/contractService'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '../config/firebase'
import { isDate, toDate } from '../utils/dateUtils'
import type { Employee, Company } from '../types/user'
import type { BankAccount, EmployeeDocument, EmployeeContract } from '../types/employeeProfile'
import '../pages/employees/EmployeeProfile.css'

function maskAccountNumber(num: string): string {
  if (num.length <= 4) return num
  return '*'.repeat(num.length - 4) + num.slice(-4)
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

export function MyProfile() {
  const { user } = useAuth()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [documents, setDocuments] = useState<EmployeeDocument[]>([])
  const [contracts, setContracts] = useState<EmployeeContract[]>([])
  const [assets, setAssets] = useState<any[]>([])

  useEffect(() => { loadData() }, [user?.id])

  const loadData = async () => {
    try {
      setLoading(true)
      if (!user?.id) { setLoading(false); return }
      const [emp, companies] = await Promise.all([
        getEmployeeByUserId(user.id).catch(() => null),
        getAllCompanies().catch(() => [] as Company[]),
      ])
      setEmployee(emp)
      if (emp) {
        setCompany(companies.find(c => c.id === emp.companyId) || null)

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
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="My Profile" />
        <div className="page-content"><div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading profile...</p></div></div>
      </div>
    )
  }

  if (!employee) {
    return (
      <div className="page-container">
        <Header title="My Profile" />
        <div className="page-content">
          <div className="loading-container">
            <p>Employee record not found. Contact your administrator.</p>
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
      <Header title="My Profile" />
      <div className="page-content">
        <div className="ep-header">
          <div className="ep-header-info">
            <div className="ep-header-top">
              <h1>{employee.name}</h1>
              <span className="ep-status-badge" style={{ background: sc.bg, color: sc.text }}>{employee.status}</span>
            </div>
            <p className="ep-designation">{employee.designation}</p>
            <p className="ep-meta">
              <Building2 size={14} /> {company?.name || 'N/A'} &middot; <Briefcase size={14} /> {employee.department}
            </p>
          </div>
        </div>

        <div className="ep-stats-row">
          <div className="ep-stat-card">
            <div className="ep-stat-icon" style={{ background: '#fff7ed', color: '#f97316' }}><Calendar size={20} /></div>
            <div className="ep-stat-info">
              <span className="ep-stat-label">Joined</span>
              <strong className="ep-stat-value">{toDate(employee.joinDate) ? toDate(employee.joinDate)!.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</strong>
            </div>
          </div>
          <div className="ep-stat-card">
            <div className="ep-stat-icon" style={{ background: '#dcfce7', color: '#16a34a' }}><Mail size={20} /></div>
            <div className="ep-stat-info">
              <span className="ep-stat-label">Email</span>
              <strong className="ep-stat-value">{employee.email}</strong>
            </div>
          </div>
          <div className="ep-stat-card">
            <div className="ep-stat-icon" style={{ background: '#fef3c7', color: '#f59e0b' }}><Phone size={20} /></div>
            <div className="ep-stat-info">
              <span className="ep-stat-label">Phone</span>
              <strong className="ep-stat-value">{employee.phone || '-'}</strong>
            </div>
          </div>
          <div className="ep-stat-card">
            <div className="ep-stat-icon" style={{ background: '#e0f2fe', color: '#0284c7' }}><Briefcase size={20} /></div>
            <div className="ep-stat-info">
              <span className="ep-stat-label">Type</span>
              <strong className="ep-stat-value">{employee.employmentType}</strong>
            </div>
          </div>
        </div>

        <div className="ep-sections">

          {/* Personal Information */}
          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <User size={18} color="#f97316" />
                <h3>Personal Information</h3>
              </div>
            </div>
            <div className="ep-section-body">
              <div className="ep-fields-grid">
                <div className="ep-field"><span className="ep-field-label">Full Name</span><span className="ep-field-value">{employee.name}</span></div>
                <div className="ep-field"><span className="ep-field-label">Email</span><span className="ep-field-value">{employee.email}</span></div>
                <div className="ep-field"><span className="ep-field-label">Phone</span><span className="ep-field-value">{employee.phone || '-'}</span></div>
                <div className="ep-field"><span className="ep-field-label">Address</span><span className="ep-field-value">{employee.address || '-'}</span></div>
                <div className="ep-field"><span className="ep-field-label">Birth Date</span><span className="ep-field-value">{toDate(employee.birthDate) ? toDate(employee.birthDate)!.toLocaleDateString() : '-'}</span></div>
                <div className="ep-field"><span className="ep-field-label">Emergency Contact</span><span className="ep-field-value">{employee.emergencyContact || '-'}</span></div>
              </div>
            </div>
          </div>

          {/* Employment Details */}
          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <Briefcase size={18} color="#f97316" />
                <h3>Employment Details</h3>
              </div>
            </div>
            <div className="ep-section-body">
              <div className="ep-fields-grid">
                <div className="ep-field"><span className="ep-field-label">Employee ID</span><span className="ep-field-value">{employee.employeeId}</span></div>
                <div className="ep-field"><span className="ep-field-label">Company</span><span className="ep-field-value">{company?.name || '-'}</span></div>
                <div className="ep-field"><span className="ep-field-label">Department</span><span className="ep-field-value">{employee.department}</span></div>
                <div className="ep-field"><span className="ep-field-label">Designation</span><span className="ep-field-value">{employee.designation}</span></div>
                <div className="ep-field"><span className="ep-field-label">Join Date</span><span className="ep-field-value">{toDate(employee.joinDate) ? toDate(employee.joinDate)!.toLocaleDateString() : '—'}</span></div>
                <div className="ep-field"><span className="ep-field-label">Employment Type</span><span className="ep-field-value">{employee.employmentType}</span></div>
                <div className="ep-field"><span className="ep-field-label">Status</span><span className="ep-field-value" style={{ color: sc.text }}>{employee.status}</span></div>
              </div>
            </div>
          </div>

          {/* Bank Details */}
          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <Banknote size={18} color="#f97316" />
                <h3>Bank Details</h3>
              </div>
            </div>
            <div className="ep-section-body">
              {bankAccounts.length === 0 ? (
                <div className="ep-empty-section"><Banknote size={24} className="ep-empty-icon" /><p>No bank information available</p></div>
              ) : (
                <div className="ep-fields-grid">
                  {bankAccounts.map(acct => (
                    <div key={acct.id} className="ep-bank-item-compact">
                      <strong>{acct.bankName}</strong>
                      <span>{maskAccountNumber(acct.accountNumber)}</span>
                      <span className="ep-bank-meta">IFSC: {acct.ifscCode} &middot; PAN: {redactPAN(acct.panNumber)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Documents */}
          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <FileText size={18} color="#f97316" />
                <h3>Documents</h3>
              </div>
            </div>
            <div className="ep-section-body">
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
                          <span>{doc.category} &middot; {doc.uploadedAt && isDate(doc.uploadedAt) ? doc.uploadedAt.toLocaleDateString() : '-'}</span>
                        </div>
                      </div>
                      {doc.fileUrl && (
                        <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="ep-doc-download">
                          View
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Assigned Assets */}
          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <Package size={18} color="#f97316" />
                <h3>Assigned Assets</h3>
              </div>
            </div>
            <div className="ep-section-body">
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
            </div>
          </div>

          {/* Contracts */}
          <div className="ep-section">
            <div className="ep-section-header">
              <div className="ep-section-title">
                <ScrollText size={18} color="#f97316" />
                <h3>Contracts</h3>
              </div>
            </div>
            <div className="ep-section-body">
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
                            <span>{isDate(ct.startDate) ? ct.startDate.toLocaleDateString() : ct.startDate}{ct.endDate ? ` - ${isDate(ct.endDate) ? ct.endDate.toLocaleDateString() : ct.endDate}` : ''}</span>
                          </div>
                        </div>
                        <span className="ep-contract-status" style={{ background: cs.bg, color: cs.color }}>{ct.status}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
