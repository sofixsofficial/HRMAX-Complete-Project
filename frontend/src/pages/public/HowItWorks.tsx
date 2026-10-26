import { Link } from 'react-router-dom'
import { Compass, Building2, Settings2, Users, ArrowRight } from 'lucide-react'
import { PageShell } from './PageShell'

/**
 * Four-step onboarding journey. Deliberately describes the REAL process: an
 * enrollment request is submitted, reviewed, then configured — the product
 * does not auto-provision organizations.
 */
const steps = [
  {
    icon: Compass,
    title: 'Explore HR MAX',
    body: 'Review the modules, see the product demo and decide which parts of HR your organization wants to run in HR MAX first.',
    link: { label: 'Browse modules', to: '/modules' },
  },
  {
    icon: Building2,
    title: 'Enroll Your Organization',
    body: 'Submit your organization and administrator details through the enrollment form. This creates a request — it does not immediately activate an account.',
    link: { label: 'Start enrollment', to: '/enroll' },
  },
  {
    icon: Settings2,
    title: 'Configure Your Workspace',
    body: 'Once approved, set up companies and departments, assign roles and permissions, and configure attendance policy such as shift timings and validation rules.',
    link: { label: 'See what you configure', to: '/modules/organization-management' },
  },
  {
    icon: Users,
    title: 'Start Managing Your Workforce',
    body: 'Invite employees, run attendance and leave day to day, and review reports according to the permissions each role has been given.',
    link: { label: 'How access works', to: '/modules/organization-management' },
  },
]

export function HowItWorks() {
  return (
    <PageShell
      title="How HR MAX Works — From Enroll to Everyday HR"
      description="The four steps to running HR on HR MAX: explore the product, enroll your organization, configure your workspace and start managing your workforce."
      eyebrow="How it works"
      h1="How HR MAX Works"
      lede="Four steps from first look to daily HR operations. Onboarding includes review and configuration — it is not an instant, automatic signup."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'How It Works' }]}
      ctaHeading="Ready to Start the Process?"
      ctaText="Submit an enrollment request, or book a demo first if you would rather see the product in action."
    >
      <section className="doc-section" aria-labelledby="steps-heading">
        <h2 id="steps-heading">The four steps</h2>
        <ol className="doc-steps">
          {steps.map((s, i) => (
            <li key={s.title}>
              <span className="doc-step-num" aria-hidden="true">{i + 1}</span>
              <span>
                <strong style={{ display: 'block', color: '#111827', marginBottom: 4 }}>
                  <s.icon size={16} style={{ verticalAlign: '-3px', marginRight: 7, color: '#f97316' }} aria-hidden="true" />
                  {s.title}
                </strong>
                {s.body}
                <Link to={s.link.to} style={{ display: 'inline-block', marginTop: 8, color: '#ea580c', fontWeight: 600 }}>
                  {s.link.label} →
                </Link>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="doc-callout" aria-labelledby="expect-heading">
        <h2 id="expect-heading">What to expect after you submit</h2>
        <p>
          Enrollment starts a request. The HR MAX team follows up to confirm details and any
          verification required before an organization is configured. Timing depends on that
          review — do not assume same-day activation. If you need to understand the timeline for
          your organization, ask during the enrollment call.
        </p>
      </section>

      <section className="doc-section" aria-labelledby="after-heading">
        <h2 id="after-heading">After setup</h2>
        <div className="doc-grid">
          <article className="doc-card">
            <h3>Invite your team</h3>
            <p>Create employee records and issue access according to each person's role.</p>
          </article>
          <article className="doc-card">
            <h3>Set attendance policy</h3>
            <p>Shift timings, grace period and any location or network validation your offices need.</p>
          </article>
          <article className="doc-card">
            <h3>Review and adjust</h3>
            <p>Permissions and structure can be refined as your rollout progresses.</p>
          </article>
        </div>
        <p style={{ marginTop: 24 }}>
          <Link to="/demo" className="hero-btn-primary">
            Explore the Product Demo <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </p>
      </section>
    </PageShell>
  )
}
