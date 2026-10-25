import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { CheckCircle, ArrowLeft, Loader2, Send, ArrowRight } from 'lucide-react'
import { sendCorporateInquiry } from '../../services/emailService'
import { Logo } from '../../components/Logo'
import { toDisplayError } from '../../aws/errors'
import './Register.css'

const TEAM_SIZE_OPTIONS = ['1-10', '11-50', '51-200', '200+']

export const Register: React.FC = () => {
  const navigate = useNavigate()

  const [formData, setFormData] = useState({
    companyName: '',
    fullName: '',
    workEmail: '',
    phoneNumber: '',
    estimatedTeamSize: '',
  })

  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError('')
  }

  const validate = () => {
    if (!formData.companyName.trim()) { setError('Company name is required'); return false }
    if (!formData.fullName.trim()) { setError('Your full name is required'); return false }
    if (!formData.workEmail.trim()) { setError('Work email is required'); return false }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.workEmail)) { setError('Please enter a valid email address'); return false }
    if (!formData.estimatedTeamSize) { setError('Please select your estimated team size'); return false }
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setIsLoading(true)
    setError('')
    try {
      await sendCorporateInquiry({
        companyName: formData.companyName.trim(),
        fullName: formData.fullName.trim(),
        workEmail: formData.workEmail.trim(),
        phoneNumber: formData.phoneNumber.trim(),
        estimatedTeamSize: formData.estimatedTeamSize,
      })
      setIsSubmitted(true)
    } catch (err: any) {
      setError(toDisplayError(err).message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isSubmitted) {
      const timer = setTimeout(() => navigate('/'), 5000)
      return () => clearTimeout(timer)
    }
  }, [isSubmitted, navigate])

  return (
    <div className="inquiry-page">
      <div className="inquiry-card">
        <div className="inquiry-header">
          <div className="inquiry-logo">
            <Logo variant="stacked" size="sm" />
          </div>
          <h1>Corporate Inquiry</h1>
          <p>Interested in HR MAX for your organization? Let us know and our team will reach out.</p>
        </div>

        <div className="inquiry-body">
          {isSubmitted ? (
            <div className="inquiry-success">
              <div className="inquiry-success-icon">
                <CheckCircle size={36} color="#10b981" />
              </div>
              <h2>Thank You!</h2>
              <p>Your request has been submitted. Our team will contact you within 24 hours.</p>
              <Link to="/" className="inquiry-success-btn">
                Return to Home <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <>
              <Link to="/login" className="back-link">
                <ArrowLeft size={14} /> Back to login
              </Link>

              <div className="inquiry-benefits">
                <div className="inquiry-benefit">
                  <CheckCircle size={16} />
                  <span>Complete HR management platform</span>
                </div>
                <div className="inquiry-benefit">
                  <CheckCircle size={16} />
                  <span>Dedicated support team</span>
                </div>
                <div className="inquiry-benefit">
                  <CheckCircle size={16} />
                  <span>Customized for your needs</span>
                </div>
              </div>

              {error && <div className="inquiry-error">{error}</div>}

              <form onSubmit={handleSubmit} className="inquiry-form">
                <div className="inquiry-field">
                  <label>Company Name *</label>
                  <input type="text" name="companyName" value={formData.companyName} onChange={handleChange} placeholder="Your Company Name" required />
                </div>
                <div className="inquiry-field">
                  <label>Your Full Name *</label>
                  <input type="text" name="fullName" value={formData.fullName} onChange={handleChange} placeholder="Your Full Name" required />
                </div>
                <div className="inquiry-field">
                  <label>Work Email *</label>
                  <input type="email" name="workEmail" value={formData.workEmail} onChange={handleChange} placeholder="you@company.com" required />
                </div>
                <div className="inquiry-field">
                  <label>Phone Number</label>
                  <input type="tel" name="phoneNumber" value={formData.phoneNumber} onChange={handleChange} placeholder="+91 0000000000" />
                </div>
                <div className="inquiry-field">
                  <label>Estimated Team Size *</label>
                  <select name="estimatedTeamSize" value={formData.estimatedTeamSize} onChange={handleChange} required>
                    <option value="" disabled>Select team size</option>
                    {TEAM_SIZE_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{opt} employees</option>
                    ))}
                  </select>
                </div>
                <div className="inquiry-submit">
                  <button type="submit" className="inquiry-btn" disabled={isLoading}>
                    {isLoading ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Submitting...</> : <><Send size={18} /> Submit Inquiry</>}
                  </button>
                </div>
              </form>

              <div className="inquiry-footer">
                <p>Already have an account? <Link to="/login">Sign in</Link></p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
