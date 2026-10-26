import { Link } from 'react-router-dom'
import { CheckCircle2, HelpCircle, ArrowRight } from 'lucide-react'
import { PageShell } from './PageShell'

/**
 * Pricing page.
 *
 * The HR MAX codebase contains no public price list, subscription tiers or
 * payment configuration, so this page deliberately does NOT publish prices,
 * trials, discounts or refund promises. It routes to Sales / Request Pricing
 * as instructed by the product brief.
 */
const included = [
  'Employee records and organizational structure',
  'Attendance with configurable validation rules',
  'Leave requests, approvals and history',
  'Payroll calculation, salary structures and salary slips',
  'Task creation, assignment and tracking',
  'Reports with CSV and PDF export',
  'Role-based permissions and audit history',
  'Multi-company separation where your plan includes it',
]

const faqs = [
  {
    q: 'How is pricing determined?',
    a: 'Pricing is confirmed by the HR MAX team based on your organization size and the modules you need. No public price list is published on this site, and no figure here should be treated as a quote.',
  },
  {
    q: 'Is there a free trial?',
    a: 'This site does not advertise a free trial. If a trial or pilot is available for your organization, the HR MAX team will confirm it when you contact them.',
  },
  {
    q: 'Which payment methods are supported?',
    a: 'Payment methods are confirmed by the HR MAX team during the sales conversation. This site does not process payments.',
  },
  {
    q: 'Are there refunds?',
    a: 'Refund terms are not published here. Request the current policy in writing from the HR MAX team before you commit.',
  },
]

export function Pricing() {
  return (
    <PageShell
      title="Pricing — Request a Quote for HR MAX"
      description="HR MAX pricing is confirmed by our team based on organization size and modules. Request pricing or book a demo — no public price list is published."
      eyebrow="Pricing"
      h1="Pricing Built Around Your Organization"
      lede="HR MAX is priced per organization and configuration. Rather than publish figures we cannot stand behind, we confirm pricing directly with you."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Pricing' }]}
      ctaHeading="Request Pricing"
      ctaText="Tell us your organization size and the modules you need — the HR MAX team will confirm availability and cost."
    >
      <section className="doc-callout" aria-labelledby="pricing-note">
        <h2 id="pricing-note">Why there is no price table here</h2>
        <p>
          HR MAX does not have a published, verified price list in the product. Any number shown
          without confirmation would be a guess. Instead, pricing is scoped to your employee
          count and module requirements, and confirmed in writing before you commit to anything.
        </p>
      </section>

      <section className="doc-section" aria-labelledby="included-heading">
        <h2 id="included-heading">What every plan covers</h2>
        <div className="doc-grid">
          <article className="doc-card">
            <h3>
              <CheckCircle2 size={17} aria-hidden="true" /> The full module set
            </h3>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#4b5563', fontSize: 14.5, lineHeight: 1.8 }}>
              {included.map(i => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </article>
          <article className="doc-card">
            <h3>
              <HelpCircle size={17} aria-hidden="true" /> How to get a real number
            </h3>
            <p>
              Send your approximate employee count, the modules you need and whether you run one
              company or several. You will get a specific proposal rather than a generic tier.
            </p>
            <Link className="doc-card-cta" to="/contact">
              Contact sales <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </article>
        </div>
      </section>

      <section className="doc-section" aria-labelledby="pricing-faq-heading">
        <h2 id="pricing-faq-heading">Pricing questions</h2>
        <div className="doc-faq">
          {faqs.map(f => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="doc-section" aria-labelledby="pricing-cta-heading">
        <h2 id="pricing-cta-heading">Two ways to get started</h2>
        <div className="page-cta-actions" style={{ justifyContent: 'flex-start' }}>
          <Link to="/contact" className="hero-btn-primary">
            Request Pricing <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link to="/demo" className="hero-btn-secondary">
            Book a Demo
          </Link>
        </div>
      </section>
    </PageShell>
  )
}
