import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, AlertCircle, Loader2, ArrowRight, MonitorPlay } from 'lucide-react'
import { PageShell } from './PageShell'
import { sendSupportTicket } from '../../services/emailService'
import { toDisplayError } from '../../aws/errors'
import { modules } from './modules-content'
import './Forms.css'

/**
 * Demo request form.
 *
 * Submits through the EXISTING public `sendSupportTicket` backend route
 * (legacy.ts, `{ public: true }`), which stores the request and emails
 * info@hrmax.in. No success state is shown until the server confirms.
 * No password, payment or employee data is collected here.
 */
export function Demo() {
  const [form, setForm] = useState({
    name: '',
    email: '',
    adminName: '',
    phone: '',
    company: '',
    size: '',
    modules: [] as string[],
    message: '',
  })
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const set = (k: keyof typeof form, v: string | string[]) => {
    setForm(prev => ({ ...prev, [k]: v }))
    setError('')
  }

  const toggleModule = (slug: string) =>
    set('modules', form.modules.includes(slug) ? form.modules.filter(s => s !== slug) : [...form.modules, slug])

  const validate = () => {
    if (!form.name.trim()) return 'Please enter your name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Please enter a valid business email address.'
    if (!form.adminName.trim()) return 'Please enter the administration full name (the person who will administer HR MAX).'
    const digits = form.phone.replace(/\D/g, '')
    if (!digits) return 'Please enter a contact number.'
    if (digits.length < 7 || digits.length > 15) return 'Please enter a valid contact number (7–15 digits).'
    if (!/^[+]?[\d\s\-().]{7,20}$/.test(form.phone.trim())) return 'Contact number contains invalid characters.'
    if (!form.company.trim()) return 'Please enter your company name.'
    if (!form.size) return 'Please select your approximate employee count.'
    if (!consent) return 'Please confirm the consent checkbox so we can respond to your request.'
    return ''
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setLoading(true)
    try {
      const labels = modules.filter(m => form.modules.includes(m.slug)).map(m => m.navLabel)
      const lines = [
        `Demo request from ${form.name.trim()} (${form.email.trim()})`,
        `Contact number: ${form.phone.trim()}`,
        `Administration full name: ${form.adminName.trim()}`,
        `Company: ${form.company.trim()}`,
        `Approximate employee count: ${form.size}`,
        `Modules of interest: ${labels.length ? labels.join(', ') : 'not specified'}`,
        '',
        form.message.trim() || 'No additional message.',
      ]
      // Real backend route -> stores a support ticket and emails info@hrmax.in.
      await sendSupportTicket({
        subject: 'Product demo request',
        description: lines.join('\n'),
        category: 'general',
        priority: 'Medium',
        userName: form.name.trim(),
        userEmail: form.email.trim(),
        companyName: form.company.trim(),
        ticketId: `demo-${Date.now()}`,
      })
      // Only now is the submission actually confirmed by the server.
      setDone(true)
    } catch (err) {
      setError(toDisplayError(err).message || 'We could not send your request. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <PageShell
        title="Demo Request Received — HR MAX"
        description="Your HR MAX demo request has been received."
        eyebrow="Product Demo"
        h1="Request received"
        hideCta
      >
        <div className="form-success" role="status">
          <CheckCircle2 size={40} aria-hidden="true" />
          <h2>Thank you — your demo request is in.</h2>
          <p>
            The HR MAX team will contact you at <strong>{form.email}</strong>
            {form.phone ? <> or <strong>{form.phone}</strong></> : null} to arrange a
            personalised walkthrough. Nothing was sent to a third party.
          </p>
          <div className="form-success-actions">
            <Link to="/demo" className="hero-btn-secondary">View the self-guided demo</Link>
            <Link to="/" className="hero-btn-primary">Back to Home <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="Book an HR MAX Demo — Personalised Product Walkthrough"
      description="Request a personalised HR MAX demo. Tell us your team size and the modules you care about and we will arrange a walkthrough with the HR MAX team."
      eyebrow="Product Demo"
      h1="Book a Personalised Demo"
      lede="See HR MAX configured around your organization's structure. Tell us what you want to cover and we will arrange a session."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Demo' }]}
      ctaHeading="Prefer to Explore First?"
      ctaText="The self-guided demo shows the product end to end before you talk to anyone."
    >
      <div className="form-layout">
        <form className="form-card" onSubmit={onSubmit} noValidate>
          <h2>Request your session</h2>

          {error && (
            <p className="form-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" /> {error}
            </p>
          )}

          <div className="form-row">
            <label>
              <span>Your name *</span>
              <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your Full Name" autoComplete="name" />
            </label>
            <label>
              <span>Business email *</span>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@company.com" autoComplete="email" />
            </label>
          </div>

          <div className="form-row">
            <label>
              <span>Administration full name *</span>
              <input
                type="text"
                value={form.adminName}
                onChange={e => set('adminName', e.target.value)}
                placeholder="Person who will administer HR MAX"
                autoComplete="off"
              />
            </label>
            <label>
              <span>Contact number *</span>
              <input
                type="tel"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="+91 98765 43210"
                autoComplete="tel"
                inputMode="tel"
              />
            </label>
          </div>

          <div className="form-row">
            <label>
              <span>Company *</span>
              <input type="text" value={form.company} onChange={e => set('company', e.target.value)} placeholder="Your Company Name" autoComplete="organization" />
            </label>
            <label>
              <span>Approximate employee count *</span>
              <select value={form.size} onChange={e => set('size', e.target.value)}>
                <option value="">Select a range</option>
                <option>1–10</option>
                <option>11–50</option>
                <option>51–200</option>
                <option>201–500</option>
                <option>500+</option>
              </select>
            </label>
          </div>

          <fieldset className="form-chips">
            <legend>Modules you want to see</legend>
            <div>
              {modules.map(m => (
                <button
                  key={m.slug}
                  type="button"
                  className={form.modules.includes(m.slug) ? 'is-on' : ''}
                  aria-pressed={form.modules.includes(m.slug)}
                  onClick={() => toggleModule(m.slug)}
                >
                  {m.navLabel}
                </button>
              ))}
            </div>
          </fieldset>

          <label>
            <span>What should we cover?</span>
            <textarea
              rows={4}
              value={form.message}
              onChange={e => set('message', e.target.value)}
              placeholder="For example: attendance validation for two offices, leave approvals, payroll review…"
            />
          </label>

          <label className="form-check">
            <input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); setError('') }} />
            <span>I agree that HR MAX may contact me about this demo request. See the <Link to="/privacy">privacy policy</Link>.</span>
          </label>

          <button type="submit" className="hero-btn-primary form-submit" disabled={loading}>
            {loading ? (<><Loader2 size={18} className="spin" aria-hidden="true" /> Sending…</>) : (<>Request Demo <ArrowRight size={18} aria-hidden="true" /></>)}
          </button>
          <p className="form-note">
            We never ask for passwords or payment details through this form.
          </p>
        </form>

        <aside className="form-aside">
          <div className="form-aside-card">
            <MonitorPlay size={22} aria-hidden="true" />
            <h3>Or watch it yourself</h3>
            <p>The self-guided walkthrough covers the whole product journey in about a minute.</p>
            <Link to="/demo#walkthrough">See the walkthrough</Link>
          </div>
          <div className="form-aside-card">
            <h3>What a demo covers</h3>
            <ul>
              <li>Your company and department structure</li>
              <li>Attendance rules for your offices</li>
              <li>Leave approval routing</li>
              <li>Reporting and exports</li>
              <li>Roles and permissions</li>
            </ul>
            <Link to="/modules">Review the modules first</Link>
          </div>
        </aside>
      </div>
    </PageShell>
  )
}
