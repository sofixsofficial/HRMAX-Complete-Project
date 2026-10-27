import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Users, Building2, Shield, BarChart3,
  Clock, CheckSquare, Mail, Phone, MapPin,
  CheckCircle2, PlayCircle, ClipboardList, Wallet, Gauge,
  Compass, SlidersHorizontal
} from 'lucide-react'
import { modules } from './modules-content'
import './Landing.css'

/**
 * Feature claims are limited to what exists in the HR MAX codebase
 * (see modules-content.ts). Unverified marketing claims — multi-currency
 * payroll, tax compliance, free trials — are deliberately not used.
 */
const features = [
  { icon: Users, title: 'Employee Management', desc: 'Profiles, departments, designations and reporting hierarchy in one searchable record.', color: '#f97316', to: '/modules/employee-management' },
  { icon: Clock, title: 'Attendance & Time', desc: 'Check-in/out with optional geofence, Wi-Fi and selfie validation.', color: '#10b981', to: '/modules/attendance' },
  { icon: Building2, title: 'Multi-Company', desc: 'Run several organizations side by side with separated data.', color: '#f59e0b', to: '/modules/organization-management' },
  { icon: Shield, title: 'Access Control', desc: 'Role-based permission matrix, audit trail and approval workflows.', color: '#ef4444', to: '/modules/organization-management' },
  { icon: BarChart3, title: 'Analytics & Reports', desc: 'Attendance, leave, payroll and task reports with CSV and PDF export.', color: '#8b5cf6', to: '/modules/reports-analytics' },
  { icon: Wallet, title: 'Payroll', desc: 'Salary structures, payroll runs and per-employee salary slips.', color: '#06b6d4', to: '/modules/payroll' },
  { icon: CheckSquare, title: 'Task Management', desc: 'Assign work, track status and review progress by team.', color: '#22c55e', to: '/modules/task-management' },
  { icon: ClipboardList, title: 'Leave Workflows', desc: 'Requests, approvals, balances and history without spreadsheets.', color: '#6366f1', to: '/modules/leave-management' },
]

const benefits = [
  'Employee records, attendance and leave on one dataset',
  'Role-based access for administrators, managers and staff',
  'Attendance policy per company: shift, grace period, geofence',
  'Reports and exports built for HR and finance reviews',
]

const walkthrough = [
  { icon: Gauge, title: 'Dashboard overview', text: 'Headcount, attendance and workload summaries at a glance.' },
  { icon: Building2, title: 'Organisation structure', text: 'Companies, departments and the people assigned to them.' },
  { icon: Users, title: 'Employee records', text: 'Search, filter and open a complete employee profile.' },
  { icon: Clock, title: 'Attendance', text: 'Daily records, check-in and check-out with policy validation.' },
  { icon: ClipboardList, title: 'Leave requests', text: 'A request moving through review and approval.' },
  { icon: BarChart3, title: 'Reports', text: 'Filter a report and export it when the numbers are ready.' },
]

const steps = [
  { n: '01', title: 'Explore', text: 'Review the modules and see how the product works.', to: '/modules', icon: Compass },
  { n: '02', title: 'Enroll', text: 'Submit your organization and administrator details.', to: '/enroll', icon: ClipboardList },
  { n: '03', title: 'Configure', text: 'Set up departments, roles and attendance policy.', to: '/how-it-works', icon: SlidersHorizontal },
  { n: '04', title: 'Operate', text: 'Invite employees and run HR day to day.', to: '/demo', icon: Users },
]

function ScrollReveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(30px)',
        transition: 'all 0.6s ease',
      }}
    >
      {children}
    </div>
  )
}

/**
 * Animated product walkthroughs.
 *
 * Two real assets are supported and each degrades honestly:
 *  - /hrmax-mobile-walkthrough.gif       mobile app screens
 *  - /hrmax-walkthrough.gif              recorded web dashboard tour
 * If a file is missing, its figure falls back to the representative dashboard
 * preview rather than rendering a broken image or claiming a recording that
 * does not exist.
 */
function GifPlayer({
  src,
  alt,
  title,
  caption,
  device,
  fallback,
}: {
  src: string
  alt: string
  title: string
  caption: string
  /** Presentation chrome: a browser bar for the web recording, a bezel for the app. */
  device: 'phone' | 'browser'
  fallback?: React.ReactNode
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading')
  const [playing, setPlaying] = useState(true)
  const ref = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => setState('ready')
    img.onerror = () => setState('fallback')
    img.src = src
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [src])

  const toggle = () => {
    if (state !== 'ready' || !ref.current) return
    ref.current.src = playing ? `${src}#paused` : src
    setPlaying(!playing)
  }

  if (state === 'fallback') {
    return fallback ? (
      <figure className={`showcase-figure showcase-figure--${device}`}>
        <div className={`showcase-frame showcase-frame--${device}`}>
          <div className="showcase-screen">{fallback}</div>
        </div>
        <figcaption>
          <strong>{title}</strong>
          <span>Representative preview built from the HR MAX design system.</span>
        </figcaption>
      </figure>
    ) : null
  }

  return (
    <figure className={`showcase-figure showcase-figure--${device}`}>
      <div className={`showcase-frame showcase-frame--${device}`}>
        {device === 'browser' ? (
          <div className="showcase-chrome" aria-hidden="true">
            <span className="showcase-dots">
              <i />
              <i />
              <i />
            </span>
            <span className="showcase-url">www.hrmax.in</span>
          </div>
        ) : (
          <span className="showcase-speaker" aria-hidden="true" />
        )}
        <div className="showcase-screen">
          {state === 'ready' ? (
            <>
              <img
                ref={ref}
                src={src}
                width={720}
                height={1110}
                alt={alt}
                loading="lazy"
                decoding="async"
              />
              <button type="button" className="showcase-toggle" onClick={toggle}>
                <PlayCircle size={18} aria-hidden="true" /> {playing ? 'Pause' : 'Replay'}
              </button>
            </>
          ) : (
            <div className="showcase-preview" aria-hidden="true">
              <div className="mock-bar" />
            </div>
          )}
        </div>
      </div>
      <figcaption>
        <strong>{title}</strong>
        <span>{caption}</span>
      </figcaption>
    </figure>
  )
}

function WalkthroughShowcase() {
  return (
    <div className="showcase-figures">
      <GifPlayer
        src="/hrmax-mobile-walkthrough.gif"
        alt="Animated preview of the HR MAX mobile app: sign-in, dashboard summary cards, employee directory, attendance check-in and leave requests."
        title="Mobile app"
        caption="Sign-in, home screen, employees, attendance and leave — the app's own screens, recorded in motion."
        device="phone"
      />
      <GifPlayer
        src="/hrmax-walkthrough.gif"
        alt="Recorded walkthrough of the HR MAX web dashboard: overview cards, company and department structure, employee records and attendance."
        title="Web workspace"
        caption="Recorded walkthrough with demonstration data only — no real employee records."
        device="browser"
        fallback={<DashboardPreview />}
      />
    </div>
  )
}

/** Representative dashboard built from the app's own design language. */
function DashboardPreview() {
  const cards = [
    { label: 'Total Employees', value: '128', delta: '+6 this month' },
    { label: 'Present Today', value: '112', delta: '87% attendance' },
    { label: 'On Leave', value: '9', delta: '4 pending approval' },
    { label: 'Open Tasks', value: '23', delta: '6 due today' },
  ]
  const bars = [42, 68, 55, 80, 62, 91, 74]
  const rows = [
    { name: 'Aarav Sharma', dept: 'Engineering', status: 'Present' },
    { name: 'Meera Patel', dept: 'Finance', status: 'On Leave' },
    { name: 'Rahul Verma', dept: 'Operations', status: 'Present' },
    { name: 'Sana Iqbal', dept: 'Human Resources', status: 'Late' },
  ]

  return (
    <div className="preview" role="img" aria-label="Representative HR MAX dashboard preview showing employee, attendance, leave and task summary cards with a weekly attendance chart.">
      <div className="preview-top">
        <span className="preview-dot" />
        <span className="preview-dot" />
        <span className="preview-dot" />
        <span className="preview-url">hrmax.in / dashboard</span>
      </div>
      <div className="preview-body">
        <div className="preview-cards">
          {cards.map(c => (
            <div key={c.label} className="preview-card">
              <span className="preview-label">{c.label}</span>
              <strong>{c.value}</strong>
              <span className="preview-delta">{c.delta}</span>
            </div>
          ))}
        </div>

        <div className="preview-split">
          <div className="preview-chart">
            <div className="preview-chart-head">Weekly attendance</div>
            <div className="preview-bars">
              {bars.map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
          <div className="preview-list">
            <div className="preview-chart-head">Today</div>
            {rows.map(r => (
              <div key={r.name} className="preview-row">
                <span className="preview-avatar">{r.name.charAt(0)}</span>
                <span className="preview-name">{r.name}</span>
                <span className="preview-dept">{r.dept}</span>
                <span className={`preview-status ${r.status.toLowerCase().replace(' ', '-')}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Landing() {
  return (
    <div className="landing-page">
      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="hero-left">
            <h1>
              Your People. Your Processes. <span>One Powerful HR Platform.</span>
            </h1>
            <p className="hero-subtitle">
              HR MAX helps organizations manage employees, attendance, leave, tasks, and HR
              operations through one connected platform.
            </p>
            <div className="hero-buttons">
              <Link to="/enroll" className="hero-btn-primary">
                Get Started <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link to="/demo" className="hero-btn-secondary">
                <PlayCircle size={18} aria-hidden="true" /> Explore the Live Demo
              </Link>
            </div>
            <ul className="hero-benefits">
              {benefits.map(b => (
                <li key={b}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  {b}
                </li>
              ))}
            </ul>
          </div>

          <div className="hero-right">
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* ── Product showcase ──────────────────────────────── */}
      <ScrollReveal>
        <section className="showcase-section" aria-labelledby="showcase-heading">
          <div className="showcase-header">
            <p className="section-eyebrow">Product tour</p>
            <h2 id="showcase-heading">See HR MAX in Action</h2>
            <p>
              Explore how everyday HR operations come together in one connected workspace.
            </p>
          </div>

          <div className="showcase-grid">
            <WalkthroughShowcase />

            <div className="showcase-notes">
              {walkthrough.map(w => (
                <div key={w.title} className="showcase-note">
                  <span className="showcase-note-icon"><w.icon size={17} aria-hidden="true" /></span>
                  <div>
                    <h3>{w.title}</h3>
                    <p>{w.text}</p>
                  </div>
                </div>
              ))}
              <div className="showcase-actions">
                <Link to="/demo" className="hero-btn-primary">
                  Explore the product demo <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <Link to="/enroll" className="hero-btn-secondary">
                  Start enrollment
                </Link>
              </div>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Modules ───────────────────────────────────────── */}
      <ScrollReveal>
        <section className="features-section">
          <div className="features-header">
            <p className="section-eyebrow">Modules</p>
            <h2>Everything You <span>Need</span></h2>
            <p>Every module works on the same employee records — nothing is entered twice.</p>
          </div>
          <div className="features-grid">
            {features.map(f => {
              const Icon = f.icon
              return (
                <Link key={f.title} to={f.to} className="feature-card feature-card-link">
                  <div className="feature-card-icon" style={{ background: `${f.color}15`, color: f.color }}>
                    <Icon aria-hidden="true" />
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                  <span className="feature-card-more">
                    Explore <ArrowRight size={14} aria-hidden="true" />
                  </span>
                </Link>
              )
            })}
          </div>
          <div className="features-footer">
            <Link to="/modules" className="hero-btn-secondary">
              View all {modules.length} modules <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Solutions ─────────────────────────────────────── */}
      <ScrollReveal>
        <section className="solutions-strip" aria-labelledby="solutions-heading">
          <div className="solutions-strip-inner">
            <div className="solutions-strip-copy">
              <p className="section-eyebrow">Solutions</p>
              <h2 id="solutions-heading">Built for how your team actually works</h2>
              <p>
                Small businesses, growing organizations, HR teams and distributed workforces
                configure the same modules differently.
              </p>
            </div>
            <div className="solutions-strip-links">
              <Link to="/solutions/small-business">Small Businesses</Link>
              <Link to="/solutions/enterprise">Growing Companies</Link>
              <Link to="/solutions/hr-teams">HR Teams</Link>
              <Link to="/solutions/remote-teams">Distributed Teams</Link>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── How it works ──────────────────────────────────── */}
      <ScrollReveal>
        <section className="steps-section" aria-labelledby="steps-heading">
          <div className="features-header">
            <p className="section-eyebrow">How it works</p>
            <h2 id="steps-heading">From sign-up to <span>daily HR</span></h2>
            <p>Four steps — enrollment is reviewed before your workspace is configured.</p>
          </div>
          <ol className="steps-grid">
            {steps.map((s, i) => {
              const StepIcon = s.icon
              return (
                <li key={s.n} className="step-item">
                  <Link to={s.to} className="step-card">
                    <span className="step-top">
                      <span className="step-icon" aria-hidden="true">
                        <StepIcon size={18} strokeWidth={2} />
                      </span>
                      <span className="step-num">{s.n}</span>
                    </span>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                    <span className="step-cta">
                      {i === 1 ? 'Start enrollment' : i === 3 ? 'Open the demo' : 'Learn more'}
                      <ArrowRight size={14} aria-hidden="true" />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
          <div className="features-footer">
            <Link to="/how-it-works" className="hero-btn-secondary">
              See the full process <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Contact ───────────────────────────────────────── */}
      <ScrollReveal>
        <section className="contact-section-landing">
          <div className="contact-section-inner">
            <div className="contact-section-header">
              <h2>Get in <span>Touch</span></h2>
              <p>Ready to transform your HR operations? Reach out to us.</p>
            </div>
            <div className="contact-section-grid">
              <div className="contact-section-card">
                <div className="contact-section-card-icon">
                  <Phone size={22} aria-hidden="true" />
                </div>
                <h3>Call Us</h3>
                <a href="tel:+919601582622">+91 96015 82622</a>
                <p>Mon-Fri, 9AM-6PM IST</p>
              </div>
              <div className="contact-section-card">
                <div className="contact-section-card-icon">
                  <Mail size={22} aria-hidden="true" />
                </div>
                <h3>Email Us</h3>
                <a href="mailto:info@hrmax.in">info@hrmax.in</a>
                <p>We reply within 24 hours</p>
              </div>
              <div className="contact-section-card">
                <div className="contact-section-card-icon">
                  <MapPin size={22} aria-hidden="true" />
                </div>
                <h3>Visit Us</h3>
                <p style={{ fontWeight: 500 }}>Surat, Gujarat, India</p>
                <p>Headquarters</p>
              </div>
            </div>
            <div className="contact-section-cta">
              <Link to="/contact" className="hero-btn-primary">
                Send us a Message <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link to="/register" className="hero-btn-secondary">
                Corporate Inquiry
              </Link>
            </div>
          </div>
        </section>
      </ScrollReveal>

      {/* ── Final CTA ─────────────────────────────────────── */}
      <section className="cta-section">
        <ScrollReveal>
          <p className="section-eyebrow section-eyebrow-dark">Get started</p>
          <h2>Ready to Bring Your HR Operations Together?</h2>
          <p>Explore HR MAX and discover a more organized way to manage your workforce.</p>
          <div className="cta-buttons">
            <Link to="/enroll" className="hero-btn-primary">
              Get Started <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link to="/contact" className="hero-btn-secondary hero-btn-on-dark">
              Talk to Our Team
            </Link>
          </div>
        </ScrollReveal>
      </section>
    </div>
  )
}
