import { Link } from 'react-router-dom'
import { Users, Target, Heart, Shield, ArrowRight, Building2, Mail, Phone, MapPin } from 'lucide-react'
import { PageShell } from './PageShell'

/**
 * About page.
 *
 * Company history, founding year, headcount, awards and certifications are
 * deliberately NOT stated — none are verifiable from the project. Claims that
 * previously appeared here ("founded in 2020 by HR tech veterans",
 * "bank-grade security", "AI and automation") were removed as unverifiable.
 * Only facts sourced from the codebase and this site are used: Sofixs builds
 * and operates HR MAX, and the published contact details below.
 */
const values = [
  {
    icon: Heart,
    title: 'People first',
    desc: 'HR work is about people. Screens, flows and reports are built so an HR team spends time on decisions, not on chasing data.',
    color: '#ef4444',
  },
  {
    icon: Target,
    title: 'One connected record',
    desc: 'Employee records, attendance, leave and payroll read from the same data, so departments stop disagreeing about the same person.',
    color: '#f97316',
  },
  {
    icon: Shield,
    title: 'Access is earned, not assumed',
    desc: 'Role-based permissions and an audit trail are part of the product — access defaults to denied until a permission is granted.',
    color: '#10b981',
  },
  {
    icon: Users,
    title: 'Built for real hierarchies',
    desc: 'Companies, departments, managers, team leaders and executives are modelled the way organizations actually work.',
    color: '#f59e0b',
  },
]

const contact = [
  { icon: Mail, label: 'info@hrmax.in', href: 'mailto:info@hrmax.in' },
  { icon: Phone, label: '+91 96015 82622', href: 'tel:+919601582622' },
  { icon: MapPin, label: 'Surat, Gujarat, India', href: null },
]

export function About() {
  return (
    <PageShell
      title="About HR MAX and Sofixs — Who Builds the Platform"
      description="HR MAX is the human resource management platform built and operated by Sofixs — employee records, attendance, leave, payroll, reporting and role-based access in one system."
      eyebrow="Company"
      h1="About HR MAX"
      lede="HR MAX is the human resource management platform built and operated by Sofixs. This page explains what the product is, who stands behind it, and how to reach the team."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'About' }]}
      ctaHeading="Want to See HR MAX With Your Own Data?"
      ctaText="Book a demo, or start an enrollment request and the team will follow up."
    >
      <section className="doc-section" aria-labelledby="what-heading">
        <h2 id="what-heading">What HR MAX is</h2>
        <p className="doc-lede">
          HR MAX is a human resource management system for organizations that want employee
          records, attendance, leave, payroll, tasks and reporting in one place instead of
          across spreadsheets and disconnected tools. It is used by administrators, company
          managers, HR teams, executives and employees — each seeing only what their role
          permits.
        </p>
        <p className="doc-lede" style={{ marginTop: 14 }}>
          The product is organized into discrete modules.{' '}
          <Link to="/modules">Every module is documented here</Link>, including what it does and
          what it deliberately does not claim to do.
        </p>
      </section>

      <section className="doc-callout" aria-labelledby="sofixs-heading">
        <h2 id="sofixs-heading">
          <Building2 size={19} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 8 }} />
          Sofixs — the team behind HR MAX
        </h2>
        <p>
          HR MAX is designed, built and operated by <strong>Sofixs</strong>, a technology company
          that develops software for business operations. Sofixs is responsible for the product
          roadmap, hosting, support and the onboarding process described in{' '}
          <Link to="/how-it-works">How It Works</Link>. You can reach the Sofixs team through the
          HR MAX contact page or at <a href="https://www.sofixs.com/">sofixs.com</a>.
        </p>
        <p style={{ marginTop: 12 }}>
          Questions about the product go to the HR MAX team; questions about Sofixs as a company
          go through the same channel and will be answered by the people who build it.
        </p>
      </section>

      <section className="doc-section" aria-labelledby="values-heading">
        <h2 id="values-heading">What we optimise for</h2>
        <div className="doc-grid">
          {values.map(v => {
            const Icon = v.icon
            return (
              <article key={v.title} className="doc-card">
                <h3>
                  <Icon size={17} aria-hidden="true" />
                  {v.title}
                </h3>
                <p>{v.desc}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="doc-section" aria-labelledby="reach-heading">
        <h2 id="reach-heading">Reach the team</h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {contact.map(c => (
            <li key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, color: '#374151' }}>
              <c.icon size={17} aria-hidden="true" style={{ color: '#f97316' }} />
              {c.href ? <a href={c.href} style={{ color: '#ea580c' }}>{c.label}</a> : <span>{c.label}</span>}
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 22 }}>
          <Link to="/contact" className="hero-btn-secondary">
            Contact the team <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </p>
      </section>
    </PageShell>
  )
}
