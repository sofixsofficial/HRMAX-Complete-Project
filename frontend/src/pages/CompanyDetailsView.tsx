import { useState, useEffect } from 'react'
import { errText } from '../aws/errors';
import { useParams, useNavigate } from 'react-router-dom'
import { Building2, MapPin, Wifi, Smartphone, Camera, DollarSign, Calendar, Clock, ArrowLeft, Pencil, Trash2, Globe, Phone, Mail, Map, Loader2, BookOpen } from 'lucide-react'
import { getCompanyById } from '../services/companyService'
import type { Company } from '../types/user'
import './CompanyDetailsView.css'

export function CompanyDetailsView() {
  const { companyId } = useParams<{ companyId: string }>()
  const navigate = useNavigate()
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    getCompanyById(companyId)
      .then(data => {
        if (!data) {
          setError('Company not found')
        } else {
          setCompany(data)
        }
      })
      .catch(err => setError(errText(err, 'Failed to load company')))
      .finally(() => setLoading(false))
  }, [companyId])

  if (loading) {
    return (
      <div className="page-container">
        <div className="page-content">
          <div className="cdv-skeleton">
            <div className="skeleton-header" />
            <div className="skeleton-cards">
              <div className="skeleton-card" />
              <div className="skeleton-card" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !company) {
    return (
      <div className="page-container">
        <div className="page-content">
          <div className="cdv-error">
            <h2>Error</h2>
            <p>{error || 'Company not found'}</p>
            <button className="btn-secondary" onClick={() => navigate('/companies')}>
              <ArrowLeft size={16} /> Back to Companies
            </button>
          </div>
        </div>
      </div>
    )
  }

  const att = company.attendanceSettings
  const pay = company.payrollSettings

  return (
    <div className="page-container">
      <div className="page-content">
        <div className="cdv-container">
          {/* Header */}
          <div className="cdv-header">
            <div className="cdv-header-left">
              <button className="btn-icon" onClick={() => navigate('/companies')} title="Back to Companies">
                <ArrowLeft size={20} />
              </button>
              <div className="cdv-header-info">
                <div className="cdv-title-row">
                  <h1>{company.name}</h1>
                  <span className={`cdv-badge ${company.status === 'Active' ? 'active' : 'inactive'}`}>
                    {company.status}
                  </span>
                </div>
                <span className="cdv-code">{company.code}</span>
              </div>
            </div>
            <div className="cdv-header-actions">
              <button className="btn-outline" onClick={() => navigate(`/companies?edit=${company.id}`)}>
                <Pencil size={16} /> Edit
              </button>
              <button className="btn-outline delete" onClick={() => navigate(`/companies?delete=${company.id}`)}>
                <Trash2 size={16} /> Delete
              </button>
            </div>
          </div>

          <div className="cdv-grid">
            {/* Card 1: Company Overview */}
            <div className="cdv-card">
              <div className="cdv-card-header">
                <Building2 size={20} />
                <h3>Company Overview</h3>
              </div>
              <div className="cdv-card-body">
                <div className="cdv-field">
                  <Mail size={16} />
                  <span className="cdv-label">Email</span>
                  <span className="cdv-value">{company.domain || '—'}</span>
                </div>
                <div className="cdv-field">
                  <Phone size={16} />
                  <span className="cdv-label">Phone</span>
                  <span className="cdv-value">{company.phone || '—'}</span>
                </div>
                <div className="cdv-field">
                  <MapPin size={16} />
                  <span className="cdv-label">Address</span>
                  <span className="cdv-value">{company.address || '—'}</span>
                </div>
                <div className="cdv-field">
                  <Globe size={16} />
                  <span className="cdv-label">Website</span>
                  <span className="cdv-value">{company.website || '—'}</span>
                </div>
                {company.description && (
                  <div className="cdv-field">
                    <BookOpen size={16} />
                    <span className="cdv-label">Description</span>
                    <span className="cdv-value">{company.description}</span>
                  </div>
                )}
                <div className="cdv-field">
                  <Clock size={16} />
                  <span className="cdv-label">Timezone</span>
                  <span className="cdv-value">{company.timezone || '—'}</span>
                </div>
                <div className="cdv-field">
                  <DollarSign size={16} />
                  <span className="cdv-label">Currency</span>
                  <span className="cdv-value">{company.currency || '—'}</span>
                </div>
                <div className="cdv-field">
                  <Building2 size={16} />
                  <span className="cdv-label">Employees</span>
                  <span className="cdv-value">{company.employees ?? 0}</span>
                </div>
                <div className="cdv-field">
                  <Calendar size={16} />
                  <span className="cdv-label">Admin</span>
                  <span className="cdv-value">
                    {company.adminName}
                    <span className="cdv-sub">{company.adminEmail}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Card 2: Attendance & Security */}
            <div className="cdv-card">
              <div className="cdv-card-header">
                <MapPin size={20} />
                <h3>Attendance &amp; Security</h3>
              </div>
              <div className="cdv-card-body">
                {att ? (
                  <>
                    <div className="cdv-field highlight">
                      <MapPin size={16} />
                      <span className="cdv-label">Office Location</span>
                      <span className="cdv-value">
                        {att.officeAddress}
                        <span className="cdv-sub">{att.latitude}, {att.longitude}</span>
                      </span>
                    </div>
                    <div className="cdv-field">
                      <Map size={16} />
                      <span className="cdv-label">Radius</span>
                      <span className="cdv-value">{att.radiusInMeters}m</span>
                    </div>
                    <div className="cdv-field">
                      <Wifi size={16} />
                      <span className="cdv-label">Office Wi-Fi</span>
                      <span className="cdv-value">
                        {att.requireWifi ? (att.wifiSSID || 'Required') : 'Not Required'}
                      </span>
                    </div>
                    <div className="cdv-field">
                      <Smartphone size={16} />
                      <span className="cdv-label">Mobile Data</span>
                      <span className="cdv-value">{att.allowMobileData ? 'Allowed' : 'Blocked'}</span>
                    </div>
                    <div className="cdv-field">
                      <Camera size={16} />
                      <span className="cdv-label">Selfie</span>
                      <span className="cdv-value">{att.requireSelfie ? 'Required' : 'Optional'}</span>
                    </div>
                  </>
                ) : (
                  <div className="cdv-not-configured">
                    <span className="not-configured-badge">Not Configured</span>
                    <p>Attendance settings have not been configured for this company.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Card 3: Payroll & Operational Rules (spans full width) */}
            <div className="cdv-card cdv-card-full">
              <div className="cdv-card-header">
                <DollarSign size={20} />
                <h3>Payroll &amp; Operational Rules</h3>
              </div>
              <div className="cdv-card-body">
                {pay ? (
                  <div className="cdv-payroll-grid">
                    <div className="cdv-payroll-item">
                      <span className="cdv-payroll-label">Salary Cycle</span>
                      <span className="cdv-payroll-value">{pay.salaryCycle}</span>
                    </div>
                    <div className="cdv-payroll-item">
                      <span className="cdv-payroll-label">Working Days / Month</span>
                      <span className="cdv-payroll-value">{pay.workingDaysPerMonth} days</span>
                    </div>
                    <div className="cdv-payroll-item">
                      <span className="cdv-payroll-label">Weekends</span>
                      <span className="cdv-payroll-value">{pay.weekends.join(', ')}</span>
                    </div>
                    <div className="cdv-payroll-item">
                      <span className="cdv-payroll-label">Overtime Rate</span>
                      <span className="cdv-payroll-value">{pay.overtimeRatePerHour}× base pay</span>
                    </div>
                    <div className="cdv-payroll-item">
                      <span className="cdv-payroll-label">Avg Salary (Monthly)</span>
                      <span className="cdv-payroll-value">{company.averageSalary ? `$${company.averageSalary.toFixed(2)}` : '—'}</span>
                    </div>
                    <div className="cdv-payroll-item">
                      <span className="cdv-payroll-label">Mandatory Attendance</span>
                      <span className="cdv-payroll-value">{company.mandatoryAttendanceDays ? `${company.mandatoryAttendanceDays} days/month` : '—'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="cdv-not-configured">
                    <span className="not-configured-badge">Not Configured</span>
                    <p>Payroll settings have not been configured for this company.</p>
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
