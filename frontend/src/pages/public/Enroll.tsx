import { FormEvent, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, AlertCircle, Loader2, ArrowRight, ArrowLeft, Building2, UserCog, SlidersHorizontal, ClipboardCheck } from 'lucide-react'
import { PageShell } from './PageShell'
import { sendCorporateInquiry } from '../../services/emailService'
import { toDisplayError } from '../../aws/errors'
import { modules } from './modules-content'
import './Forms.css'

/**
 * Organization enrollment.
 *
 * IMPORTANT — this form is intentionally NOT a second signup system. It maps
 * onto the application's existing public `corporateInquiry` route
 * (backend legacy.ts, `{ public: true }`), which stores the request and emails
 * info@hrmax.in for follow-up. No password, payment or employee data is
 * collected, and no success state is shown until the server confirms.
 */
const stepDefs = [
  { title: 'Organization', icon: Building2 },
  { title: 'Administrator', icon: UserCog },
  { title: 'Requirements', icon: SlidersHorizontal },
  { title: 'Review', icon: ClipboardCheck },
]

const industries = ['', 'Technology', 'Manufacturing', 'Retail & E-commerce', 'Healthcare', 'Education', 'Finance', 'Construction', 'Hospitality', 'Services', 'Other']
const sizes = ['', '1–10', '11–50', '51–200', '201–500', '500+']
const contactMethods = ['', 'Email', 'Phone call', 'Video call']

interface EnrollForm {
  orgName: string
  industry: string
  country: string
  size: string
  businessEmail: string
  phone: string
  adminName: string
  adminEmail: string
  adminTitle: string
  adminPhone: string
  modules: string[]
  employeeCount: string
  contactMethod: string
  requirements: string
}

const empty: EnrollForm = {
  orgName: '', industry: '', country: '', size: '', businessEmail: '', phone: '',
  adminName: '', adminEmail: '', adminTitle: '', adminPhone: '',
  modules: [], employeeCount: '', contactMethod: '', requirements: '',
}

export function Enroll() {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<EnrollForm>(empty)
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const set = <K extends keyof EnrollForm>(k: K, v: EnrollForm[K]) => {
    setForm(prev => ({ ...prev, [k]: v }))
    setError('')
  }

  const toggleModule = (slug: string) =>
    set('modules', form.modules.includes(slug) ? form.modules.filter(s => s !== slug) : [...form.modules, slug])

  const validateStep = (s: number): string => {
    const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
    if (s === 0) {
      if (!form.orgName.trim()) return 'Organization name is required.'
      if (!form.industry) return 'Please select an industry.'
      if (!form.country.trim()) return 'Country is required.'
      if (!form.size) return 'Please select your organization size.'
      if (!emailOk(form.businessEmail)) return 'A valid business email is required.'
      if (!form.phone.trim()) return 'Contact number is required.'
    }
    if (s === 1) {
      if (!form.adminName.trim()) return 'Administrator full name is required.'
      if (!emailOk(form.adminEmail)) return 'A valid administrator email is required.'
      if (!form.adminTitle.trim()) return 'Job title is required.'
    }
    if (s === 2) {
      if (form.modules.length === 0) return 'Select at least one module of interest.'
      if (!form.employeeCount.trim()) return 'Approximate employee count is required.'
      if (!form.contactMethod) return 'Please choose how we should contact you.'
    }
    if (s === 3 && !consent) return 'Please confirm the consent checkbox before submitting.'
    return ''
  }

  const next = () => {
    const problem = validateStep(step)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setStep(s => Math.min(s + 1, stepDefs.length - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const back = () => {
    setError('')
    setStep(s => Math.max(s - 1, 0))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = validateStep(3)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setLoading(true)
    try {
      const labels = modules.filter(m => form.modules.includes(m.slug)).map(m => m.navLabel)
      const message = [
        `ORGANIZATION ENROLLMENT REQUEST`,
        `Organization: ${form.orgName.trim()}`,
        `Industry: ${form.industry}`,
        `Country: ${form.country.trim()}`,
        `Organization size: ${form.size}`,
        `Business email: ${form.businessEmail.trim()}`,
        `Contact number: ${form.phone.trim()}`,
        ``,
        `Administrator: ${form.adminName.trim()} (${form.adminTitle.trim()})`,
        `Administrator email: ${form.adminEmail.trim()}`,
        form.adminPhone.trim() ? `Administrator phone: ${form.adminPhone.trim()}` : '',
        ``,
        `Modules of interest: ${labels.join(', ')}`,
        `Approximate employee count: ${form.employeeCount.trim()}`,
        `Preferred contact method: ${form.contactMethod}`,
        ``,
        `Additional requirements:`,
        form.requirements.trim() || '(none)',
      ].filter(l => l !== '').join('\n')

      // Real, existing public endpoint -> stored + emailed to info@hrmax.in.
      await sendCorporateInquiry({
        companyName: form.orgName.trim(),
        fullName: form.adminName.trim(),
        workEmail: form.adminEmail.trim() || form.businessEmail.trim(),
        phoneNumber: form.phone.trim(),
        estimatedTeamSize: form.employeeCount.trim() || form.size,
      })

      // Keep the detailed payload too, so nothing the applicant typed is lost.
      try {
        const { sendSupportTicket } = await import('../../services/emailService')
        await sendSupportTicket({
          subject: `Enrollment details — ${form.orgName.trim()}`,
          description: message,
          category: 'general',
          priority: 'High',
          userName: form.adminName.trim(),
          userEmail: form.adminEmail.trim() || form.businessEmail.trim(),
          phone: form.phone.trim(),
          companyName: form.orgName.trim(),
          ticketId: `enroll-${Date.now()}`,
        })
      } catch {
        // The primary inquiry already succeeded; detail email is best-effort.
      }

      setDone(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(toDisplayError(err).message || 'We could not submit your request. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <PageShell
        title="Enrollment Request Received — HR MAX"
        description="Your HR MAX organization enrollment request has been received."
        eyebrow="Enrollment"
        h1="Enrollment request received"
        hideCta
      >
        <div className="form-success" role="status">
          <CheckCircle2 size={40} aria-hidden="true" />
          <h2>Your request is with the HR MAX team</h2>
          <p>
            We have recorded your request for <strong>{form.orgName}</strong> and sent it to the
            team. A confirmation and follow-up instructions will be sent to{' '}
            <strong>{form.adminEmail || form.businessEmail}</strong>.
          </p>
          <p>
            <strong>Enrollment may be subject to verification or approval</strong> before your
            organization is configured — submission does not activate an account immediately.
          </p>
          <ol className="doc-steps" style={{ textAlign: 'left', maxWidth: 640, margin: '24px auto 0' }}>
            {[
              'Receive confirmation and follow-up instructions.',
              'Complete any required verification or approval.',
              'The organization and administrator access are configured.',
              'Set up roles, teams and policies.',
              'Invite authorized employees.',
              'Begin using HR MAX.',
            ].map((t, i) => (
              <li key={i}>
                <span className="doc-step-num" aria-hidden="true">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
          <div className="form-success-actions" style={{ marginTop: 26 }}>
            <Link to="/demo" className="hero-btn-secondary">Book a demo meanwhile</Link>
            <Link to="/" className="hero-btn-primary">Back to Home <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell
      title="Enroll Your Organization — HR MAX Onboarding"
      description="Submit your organization and administrator details to start HR MAX onboarding. Four short steps, followed by verification and workspace configuration."
      eyebrow="Enrollment"
      h1="Enroll Your Organization"
      lede="Four short steps. Your submission starts a request — it does not activate an account instantly."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Enroll' }]}
      ctaHeading="Would You Rather See It First?"
      ctaText="Book a demo before enrolling, or read how the four onboarding steps work."
    >
      <ol className="form-steps" aria-label="Enrollment progress">
        {stepDefs.map((s, i) => (
          <li
            key={s.title}
            className={i === step ? 'is-active' : i < step ? 'is-done' : ''}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className="step-index" aria-hidden="true">{i < step ? '✓' : i + 1}</span>
            {s.title}
          </li>
        ))}
      </ol>

      <form className="form-card" onSubmit={step === 3 ? submit : e => { e.preventDefault(); next() }} noValidate>
        {error && (
          <p className="form-error" role="alert">
            <AlertCircle size={16} aria-hidden="true" /> {error}
          </p>
        )}

        {/* ── Step 1 ─────────────────────────────────────── */}
        {step === 0 && (
          <>
            <h2>Organization details</h2>
            <div className="form-row">
              <label>
                <span>Legal or business name *</span>
                <input type="text" value={form.orgName} onChange={e => set('orgName', e.target.value)} placeholder="Your Company Name" />
              </label>
              <label>
                <span>Industry *</span>
                <select value={form.industry} onChange={e => set('industry', e.target.value)}>
                  {industries.map(i => <option key={i} value={i}>{i || 'Select industry'}</option>)}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                <span>Country *</span>
                <input type="text" value={form.country} onChange={e => set('country', e.target.value)} placeholder="Your country" />
              </label>
              <label>
                <span>Organization size *</span>
                <select value={form.size} onChange={e => set('size', e.target.value)}>
                  {sizes.map(s => <option key={s} value={s}>{s || 'Select size'}</option>)}
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                <span>Business email *</span>
                <input type="email" value={form.businessEmail} onChange={e => set('businessEmail', e.target.value)} placeholder="you@company.com" />
              </label>
              <label>
                <span>Contact number *</span>
                <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 0000000000" />
              </label>
            </div>
          </>
        )}

        {/* ── Step 2 ─────────────────────────────────────── */}
        {step === 1 && (
          <>
            <h2>Administrator details</h2>
            <div className="form-row">
              <label>
                <span>Full name *</span>
                <input type="text" value={form.adminName} onChange={e => set('adminName', e.target.value)} placeholder="Your Full Name" />
              </label>
              <label>
                <span>Work email *</span>
                <input type="email" value={form.adminEmail} onChange={e => set('adminEmail', e.target.value)} placeholder="you@company.com" />
              </label>
            </div>
            <div className="form-row">
              <label>
                <span>Job title *</span>
                <input type="text" value={form.adminTitle} onChange={e => set('adminTitle', e.target.value)} placeholder="e.g. HR Manager" />
              </label>
              <label>
                <span>Phone number</span>
                <input type="tel" value={form.adminPhone} onChange={e => set('adminPhone', e.target.value)} placeholder="+91 0000000000" />
              </label>
            </div>
            <p className="form-note" style={{ textAlign: 'left' }}>
              This account will be reviewed before any administrator access is granted.
            </p>
          </>
        )}

        {/* ── Step 3 ─────────────────────────────────────── */}
        {step === 2 && (
          <>
            <h2>Product requirements</h2>
            <fieldset className="form-chips">
              <legend>Modules of interest *</legend>
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
            <div className="form-row">
              <label>
                <span>Approximate employee count *</span>
                <input type="text" value={form.employeeCount} onChange={e => set('employeeCount', e.target.value)} placeholder="e.g. 120" />
              </label>
              <label>
                <span>Preferred contact method *</span>
                <select value={form.contactMethod} onChange={e => set('contactMethod', e.target.value)}>
                  {contactMethods.map(c => <option key={c} value={c}>{c || 'Select method'}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span>Additional requirements</span>
              <textarea rows={4} value={form.requirements} onChange={e => set('requirements', e.target.value)} placeholder="Anything specific you need to see or confirm…" />
            </label>
          </>
        )}

        {/* ── Step 4 ─────────────────────────────────────── */}
        {step === 3 && (
          <>
            <h2>Review and submit</h2>
            <dl className="form-review">
              <div><dt>Organization</dt><dd>{form.orgName} · {form.industry} · {form.country} · {form.size}</dd></div>
              <div><dt>Business contact</dt><dd>{form.businessEmail} · {form.phone}</dd></div>
              <div><dt>Administrator</dt><dd>{form.adminName} ({form.adminTitle}) · {form.adminEmail}{form.adminPhone ? ` · ${form.adminPhone}` : ''}</dd></div>
              <div><dt>Modules</dt><dd>{modules.filter(m => form.modules.includes(m.slug)).map(m => m.navLabel).join(', ') || '—'}</dd></div>
              <div><dt>Employees</dt><dd>{form.employeeCount}</dd></div>
              <div><dt>Contact by</dt><dd>{form.contactMethod}</dd></div>
              <div><dt>Requirements</dt><dd>{form.requirements || 'None specified'}</dd></div>
            </dl>

            <label className="form-check">
              <input type="checkbox" checked={consent} onChange={e => { setConsent(e.target.checked); setError('') }} />
              <span>
                I confirm these details are accurate and agree that HR MAX may contact me about this
                enrollment. See the <Link to="/privacy">privacy policy</Link>.
              </span>
            </label>

            <p className="form-note" style={{ textAlign: 'left', marginTop: 14 }}>
              Submission creates an enrollment request subject to verification or approval — it
              does not immediately activate an organization or administrator account.
            </p>
          </>
        )}

        <div className="form-nav">
          {step > 0 ? (
            <button type="button" className="form-back" onClick={back}>
              <ArrowLeft size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} aria-hidden="true" /> Back
            </button>
          ) : (
            <span />
          )}

          {step < stepDefs.length - 1 ? (
            <button type="submit" className="hero-btn-primary" style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              Continue <ArrowRight size={18} aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className="hero-btn-primary form-submit" disabled={loading} style={{ width: 'auto' }}>
              {loading ? (<><Loader2 size={18} className="spin" aria-hidden="true" /> Submitting…</>) : (<>Submit Enrollment <ArrowRight size={18} aria-hidden="true" /></>)}
            </button>
          )}
        </div>
      </form>
    </PageShell>
  )
}
