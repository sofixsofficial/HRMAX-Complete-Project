import { Link } from 'react-router-dom'
import { ShieldCheck, KeyRound, Network, ScrollText, Database, LifeBuoy, ArrowRight } from 'lucide-react'
import { PageShell } from './PageShell'

/**
 * Security page.
 *
 * Only controls that exist in the HR MAX codebase are described. No
 * certifications, compliance badges, penetration-test claims or uptime
 * figures are made — none of them are verifiable from the source.
 */
const controls = [
  {
    icon: KeyRound,
    title: 'Authentication and access control',
    body: 'Sign-in is required before any data is returned. Every authenticated request resolves the caller and authorizes it against their stored permissions — a missing or invalid token is rejected.',
  },
  {
    icon: ShieldCheck,
    title: 'Role-based permissions',
    body: 'Permissions are stored per role and evaluated per request. Access is denied by default until a permission is granted, and company-scoped roles are limited to their own organization’s data.',
  },
  {
    icon: Network,
    title: 'Organization data separation',
    body: 'Data is partitioned by company, so an administrator working inside one organization reads that organization’s records rather than the whole dataset.',
  },
  {
    icon: ScrollText,
    title: 'Audit trail',
    body: 'Sensitive actions — including password changes and configuration edits — are recorded with the actor, action, target and timestamp so changes can be reviewed after the fact.',
  },
  {
    icon: Database,
    title: 'Password and account management',
    body: 'Password changes are server-verified: the current password is confirmed, the policy is enforced, and the event is written to the audit log. Reset flows use single-use codes delivered by email.',
  },
  {
    icon: LifeBuoy,
    title: 'Rate limiting on sensitive routes',
    body: 'Credential-sensitive endpoints such as password reset and change are rate-limited per account and per source, slowing down automated guessing.',
  },
]

export function Security() {
  return (
    <PageShell
      title="Security at HR MAX — Access Control, Audit Trails and Data Separation"
      description="How HR MAX protects your organization: authenticated access, role-based permissions, company data separation, audit logging, password policy and rate limiting."
      eyebrow="Trust"
      h1="Security at HR MAX"
      lede="A plain-language description of the controls that actually run in the product. We describe what is implemented — not what sounds impressive."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Security' }]}
      ctaHeading="Need Security Details for a Review?"
      ctaText="Ask the HR MAX team for the information your security or procurement process requires."
    >
      <section className="doc-section" aria-labelledby="controls-heading">
        <h2 id="controls-heading">Controls in the product</h2>
        <div className="doc-grid">
          {controls.map(c => (
            <article key={c.title} className="doc-card">
              <h3>
                <c.icon size={17} aria-hidden="true" />
                {c.title}
              </h3>
              <p>{c.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="doc-callout" aria-labelledby="no-cert">
        <h2 id="no-cert">What we do not claim</h2>
        <p>
          HR MAX does not display certification or compliance badges (ISO, SOC 2, GDPR
          certification and similar) on this site, because none have been verified for this
          deployment. If your procurement process requires specific evidence — data residency,
          retention terms, backup practice or subprocessors — request it from the HR MAX team in
          writing and evaluate the response before purchasing.
        </p>
      </section>

      <section className="doc-section" aria-labelledby="reporting-heading">
        <h2 id="reporting-heading">Reporting a security concern</h2>
        <p className="doc-lede">
          If you believe you have found a security issue in HR MAX, contact the team directly with
          a description of what you observed, the affected endpoint or screen, and steps to
          reproduce it. Please avoid accessing data that does not belong to your organization.
        </p>
        <p style={{ marginTop: 20 }}>
          <Link to="/contact" className="hero-btn-primary">
            Contact the HR MAX team <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </p>
      </section>

      <section className="doc-section" aria-labelledby="related-security">
        <h2 id="related-security">Related reading</h2>
        <div className="doc-related">
          <Link className="doc-related-link" to="/modules/organization-management">Roles &amp; permissions</Link>
          <Link className="doc-related-link" to="/privacy">Privacy policy</Link>
          <Link className="doc-related-link" to="/faq">Security FAQ</Link>
        </div>
      </section>
    </PageShell>
  )
}
