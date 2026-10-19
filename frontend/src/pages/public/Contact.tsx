import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle, ArrowLeft, Loader2, Send, ArrowRight, Mail, Phone, MapPin } from 'lucide-react'
import { sendSupportTicket } from '../../services/emailService'
import { Logo } from '../../components/Logo'
import './Contact.css'

const CONTACT_INFO = [
  { icon: Phone, label: 'Phone', value: '9601582622', href: 'tel:+919601582622' },
  { icon: Mail, label: 'Email', value: 'info@hrmax.in', href: 'mailto:info@hrmax.in' },
  { icon: MapPin, label: 'Address', value: 'Surat, Gujarat, India', href: null },
]

const TEAM_SIZE_OPTIONS = ['1-10', '11-50', '51-200', '200+']

export function Contact() {
  const [form, setForm] = useState({
    companyName: '',
    fullName: '',
    workEmail: '',
    phoneNumber: '',
    subject: '',
    message: '',
  })

  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
    setError('')
  }

  const validate = () => {
    if (!form.fullName.trim()) { setError('Your full name is required'); return false }
    if (!form.workEmail.trim()) { setError('Work email is required'); return false }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.workEmail)) { setError('Please enter a valid email address'); return false }
    if (!form.message.trim()) { setError('Please enter your message'); return false }
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setIsLoading(true)
    setError('')
    try {
      const ticketId = `contact-${Date.now()}`
      await sendSupportTicket({
        subject: form.subject || 'General Inquiry',
        description: form.message,
        category: 'general',
        userName: form.fullName,
        userEmail: form.workEmail,
        phone: form.phoneNumber,
        companyName: form.companyName,
        ticketId,
      })
      setIsSubmitted(true)
    } catch (err: any) {
      setError(err.message || 'Failed to send message. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="contact-page">
      <div className="contact-card">
        <div className="contact-header">
          <div className="contact-logo">
            <Logo variant="stacked" size="sm" />
          </div>
          <h1>Contact Us</h1>
          <p>Have a question or need help? Our team will get back to you within 24 hours.</p>
        </div>

        <div className="contact-body">
          {isSubmitted ? (
            <div className="contact-success">
              <div className="contact-success-icon">
                <CheckCircle size={36} color="#10b981" />
              </div>
              <h2>Thank You!</h2>
              <p>Your message has been sent successfully. Our team will contact you within 24 hours.</p>
              <Link to="/" className="contact-success-btn">
                Return to Home <ArrowRight size={16} />
              </Link>
            </div>
          ) : (
            <>
              <Link to="/" className="contact-back-link">
                <ArrowLeft size={14} /> Back to home
              </Link>

              <div className="contact-benefits">
                <div className="contact-benefit">
                  <CheckCircle size={16} />
                  <span>24-hour response time</span>
                </div>
                <div className="contact-benefit">
                  <CheckCircle size={16} />
                  <span>Dedicated support</span>
                </div>
                <div className="contact-benefit">
                  <CheckCircle size={16} />
                  <span>No commitment required</span>
                </div>
              </div>

              {error && <div className="contact-error">{error}</div>}

              <form onSubmit={handleSubmit} className="contact-form">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="contact-field">
                    <label>Your Full Name *</label>
                    <input type="text" name="fullName" value={form.fullName} onChange={handleChange} placeholder="John Doe" required />
                  </div>
                  <div className="contact-field">
                    <label>Work Email *</label>
                    <input type="email" name="workEmail" value={form.workEmail} onChange={handleChange} placeholder="you@company.com" required />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div className="contact-field">
                    <label>Company Name</label>
                    <input type="text" name="companyName" value={form.companyName} onChange={handleChange} placeholder="Acme Corporation" />
                  </div>
                  <div className="contact-field">
                    <label>Phone Number</label>
                    <input type="tel" name="phoneNumber" value={form.phoneNumber} onChange={handleChange} placeholder="+91 96015 82622" />
                  </div>
                </div>
                <div className="contact-field">
                  <label>Subject</label>
                  <select name="subject" value={form.subject} onChange={handleChange}>
                    <option value="">Select topic</option>
                    <option value="General Inquiry">General Inquiry</option>
                    <option value="Sales">Sales</option>
                    <option value="Support">Support</option>
                    <option value="Partnership">Partnership</option>
                  </select>
                </div>
                <div className="contact-field">
                  <label>Message *</label>
                  <textarea name="message" value={form.message} onChange={handleChange} placeholder="How can we help you?" rows={4} required />
                </div>
                <div className="contact-submit">
                  <button type="submit" className="contact-btn" disabled={isLoading}>
                    {isLoading ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Sending...</> : <><Send size={18} /> Send Message</>}
                  </button>
                </div>
              </form>

              <div className="contact-info-section">
                <h3>Get in Touch</h3>
                <div className="contact-info-grid">
                  {CONTACT_INFO.map(info => {
                    const Icon = info.icon
                    const Wrapper = info.href ? 'a' : 'div'
                    return (
                      <div key={info.label} className="contact-info-item">
                        <Icon size={18} />
                        <div>
                          <div className="info-label">{info.label}</div>
                          <div className="info-value">{info.value}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
