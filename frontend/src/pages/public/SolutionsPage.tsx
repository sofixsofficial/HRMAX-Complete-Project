import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { PageShell } from './PageShell'

/**
 * Solutions content. Each entry describes a real way HR MAX is used, tied to
 * modules that actually exist in the product. No invented metrics, customers
 * or outcomes.
 */
interface Solution {
  slug: string
  navLabel: string
  h1: string
  lede: string
  audience: string
  challenges: string[]
  approach: string[]
  bestModules: { label: string; to: string }[]
  nextStep: string
}

const solutions: Solution[] = [
  {
    slug: 'small-business',
    navLabel: 'Small Businesses',
    h1: 'HR Management for Small Businesses',
    lede:
      'Replace spreadsheets and chat threads with one system that holds employee records, attendance and leave — without an HR department to administer it.',
    audience:
      'Founders, office managers and administrative staff who handle HR alongside everything else.',
    challenges: [
      'Employee details live in spreadsheets that go stale the moment someone changes role or department.',
      'Attendance is recorded manually and reconciled at the end of the month.',
      'Leave requests arrive over chat with no record of who approved what.',
      'Nobody has time to maintain a complex HR system.',
    ],
    approach: [
      'Start with employee records and departments so there is one source of truth.',
      'Turn on attendance with the validation rules that match how your team actually works.',
      'Use leave requests and approvals instead of informal messages.',
      'Add payroll once records and attendance are dependable.',
    ],
    bestModules: [
      { label: 'Employee Management', to: '/modules/employee-management' },
      { label: 'Attendance Management', to: '/modules/attendance' },
      { label: 'Leave Management', to: '/modules/leave-management' },
    ],
    nextStep:
      'Enroll your organization and configure the first company, department and administrator.',
  },
  {
    slug: 'enterprise',
    navLabel: 'Growing Companies',
    h1: 'HR Systems for Growing Organizations',
    lede:
      'As headcount grows, structure and permissions have to grow with it. HR MAX models multiple companies, departments and roles so the right people see the right records.',
    audience:
      'HR leaders and administrators managing several departments, locations or legal entities.',
    challenges: [
      'Headcount growth outpaces the spreadsheets that used to work fine.',
      'Permissions are all-or-nothing: either everyone sees payroll or nobody can do their job.',
      'Multiple companies or branches need separation without separate tools.',
      'Leadership expects consistent reporting across the organization.',
    ],
    approach: [
      'Model companies and departments so data stays separated by structure.',
      'Assign roles and save a permission matrix per role, module by module.',
      'Route approvals — leave, attendance corrections, company requests — to the right owner.',
      'Report consistently across the same records everyone already uses.',
    ],
    bestModules: [
      { label: 'Organization & Access Control', to: '/modules/organization-management' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics' },
      { label: 'Employee Management', to: '/modules/employee-management' },
    ],
    nextStep:
      'Book a demo so the HR MAX team can map your structure before you enroll.',
  },
  {
    slug: 'hr-teams',
    navLabel: 'HR Teams',
    h1: 'HR Operations for HR Teams',
    lede:
      'Give the HR function one workspace for records, policies, approvals and reporting — with an audit trail behind every change.',
    audience:
      'HR managers, HR generalists and people-operations teams responsible for policy and process.',
    challenges: [
      'Policy exists in documents but execution happens in inboxes.',
      'Approvals are inconsistent because there is no single queue.',
      'Recurring questions about balances and status consume HR time.',
      'Leadership asks for numbers that take days to assemble.',
    ],
    approach: [
      'Keep employee records and organizational structure authoritative in HR MAX.',
      'Run leave and attendance approvals through defined queues.',
      'Use audit logs to see who changed what and when.',
      'Answer status questions from live reporting instead of rebuilding spreadsheets.',
    ],
    bestModules: [
      { label: 'Leave Management', to: '/modules/leave-management' },
      { label: 'Attendance Management', to: '/modules/attendance' },
      { label: 'Organization & Access Control', to: '/modules/organization-management' },
    ],
    nextStep:
      'Request a demo focused on your approval and reporting workflows.',
  },
  {
    slug: 'remote-teams',
    navLabel: 'Distributed Teams',
    h1: 'Attendance and HR for Distributed Teams',
    lede:
      'Hybrid and remote teams still need dependable attendance. HR MAX validates check-ins against configured location and network rules instead of trusting a message in chat.',
    audience:
      'Organizations with hybrid, field or multi-site teams where people are not all in one office.',
    challenges: [
      'Attendance cannot be verified when nobody shares a physical office.',
      'Different sites need different rules, but the process must stay consistent.',
      'Managers need to see who is working, where, without micromanaging.',
      'Corrections and missed punches pile up without a clear path.',
    ],
    approach: [
      'Configure attendance policy per company, including geofence radius or Wi-Fi requirements where they apply.',
      'Let employees check in from the app with selfie verification where enabled.',
      'Handle missed punches through a correction request and approval.',
      'Review attendance in reports by person, team and period.',
    ],
    bestModules: [
      { label: 'Attendance Management', to: '/modules/attendance' },
      { label: 'Task Management', to: '/modules/task-management' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics' },
    ],
    nextStep:
      'Talk to the HR MAX team about how validation should work for your locations.',
  },
]

export function SolutionPage() {
  const { slug = '' } = useParams()
  const s = solutions.find(x => x.slug === slug)
  if (!s) return <Navigate to="/404" replace />

  return (
    <PageShell
      title={`${s.h1} — HR MAX Solutions`}
      description={s.lede}
      eyebrow="Solution"
      h1={s.h1}
      lede={s.lede}
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Solutions', to: '/solutions' }, { label: s.navLabel }]}
      ctaHeading="See How This Works With Your Team"
      ctaText={s.nextStep}
    >
      <section className="doc-section" aria-labelledby="audience-heading">
        <h2 id="audience-heading">Who this is for</h2>
        <p className="doc-lede">{s.audience}</p>
      </section>

      <section className="doc-section" aria-labelledby="challenges-heading">
        <h2 id="challenges-heading">The problems this solves</h2>
        <ul className="doc-steps">
          {s.challenges.map((c, i) => (
            <li key={i}>
              <span className="doc-step-num" aria-hidden="true">{i + 1}</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="doc-section" aria-labelledby="approach-heading">
        <h2 id="approach-heading">How teams approach it in HR MAX</h2>
        <ol className="doc-steps">
          {s.approach.map((a, i) => (
            <li key={i}>
              <span className="doc-step-num" aria-hidden="true">{i + 1}</span>
              <span>{a}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="doc-section" aria-labelledby="modules-heading">
        <h2 id="modules-heading">Modules that matter here</h2>
        <div className="doc-related">
          {s.bestModules.map(m => (
            <Link key={m.to} to={m.to} className="doc-related-link">
              {m.label} <ArrowRight size={15} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </PageShell>
  )
}

export function SolutionsIndex() {
  return (
    <PageShell
      title="HR MAX Solutions — By Team Shape and Size"
      description="How small businesses, growing organizations, HR teams and distributed workforces use HR MAX to run employee records, attendance, leave and reporting."
      eyebrow="Solutions"
      h1="Solutions Built Around How You Work"
      lede="The same modules, configured for the way your organization is actually structured. Pick the situation closest to yours."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Solutions' }]}
      ctaHeading="Not Sure Which Fits?"
      ctaText="Tell the HR MAX team how your organization is structured and they will walk you through the relevant setup."
    >
      <section className="doc-section" aria-labelledby="solution-list-heading">
        <h2 id="solution-list-heading">Choose your situation</h2>
        <div className="doc-grid">
          {solutions.map(s => (
            <article key={s.slug} className="doc-card doc-card-link">
              <h3>
                <Link to={`/solutions/${s.slug}`}>{s.navLabel}</Link>
              </h3>
              <p>{s.lede}</p>
              <Link className="doc-card-cta" to={`/solutions/${s.slug}`}>
                Read more <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="doc-callout" aria-labelledby="honest-heading">
        <h2 id="honest-heading">What we will not claim</h2>
        <p>
          HR MAX does not publish customer counts, performance statistics or case studies that
          have not been verified. Solutions describe how the product is configured — nothing
          more. Ask the team for specifics relevant to your organization.
        </p>
      </section>
    </PageShell>
  )
}
