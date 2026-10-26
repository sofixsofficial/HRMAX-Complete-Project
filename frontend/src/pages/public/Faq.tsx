import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, X, ChevronRight } from 'lucide-react'
import { PageShell } from './PageShell'

/**
 * Searchable FAQ. Answers are limited to what the product actually does; where
 * a policy is unknown the answer tells the reader to confirm with the team
 * rather than inventing a number or promise.
 */
type Category = 'Product' | 'Enrollment' | 'Attendance' | 'Leave' | 'Payroll' | 'Security & Access' | 'Billing & Support'

interface QA {
  cat: Category
  q: string
  a: string
  link?: { label: string; to: string }
}

const faqs: QA[] = [
  // Product
  { cat: 'Product', q: 'What is HR MAX?', a: 'HR MAX is a human resource management system built by Sofixs. It manages employee records, attendance, leave, payroll, tasks, reporting and access control from one connected workspace.' , link: { label: 'See all modules', to: '/modules' } },
  { cat: 'Product', q: 'What business problems does HR MAX solve?', a: 'It removes the fragmentation of spreadsheets, chat approvals and disconnected tools by keeping one employee record that attendance, leave, payroll and reporting all read from.' },
  { cat: 'Product', q: 'Which modules are available?', a: 'Employee management, attendance, leave, payroll, task management, reports and analytics, and organization & access control.', link: { label: 'Module details', to: '/modules' } },
  { cat: 'Product', q: 'Is HR MAX suitable for small businesses?', a: 'Yes. Small organizations typically start with employee records, attendance and leave, then add payroll once the underlying records are dependable.', link: { label: 'Small business solution', to: '/solutions/small-business' } },
  { cat: 'Product', q: 'Can larger organizations use HR MAX?', a: 'Yes — HR MAX supports multiple companies, departments and role-based permissions. Confirm the scale and structure you need with the team before enrolling.', link: { label: 'Growing organizations', to: '/solutions/enterprise' } },
  { cat: 'Product', q: 'Can employees access their own records?', a: 'Yes. Employees can view their own profile, attendance and leave according to their role permissions. Other people’s records stay restricted.' },
  { cat: 'Product', q: 'Can managers access team information?', a: 'Yes — managers, team leaders and executives see the people they are responsible for, as defined by their role and permission set.' },

  // Enrollment
  { cat: 'Enrollment', q: 'How do I enroll my organization?', a: 'Submit the enrollment form with your organization and administrator details. The HR MAX team follows up to confirm and configure.', link: { label: 'Go to enrollment', to: '/enroll' } },
  { cat: 'Enrollment', q: 'What information is required?', a: 'Organization name, industry, country, size, a business email and contact number, plus administrator details and the modules you are interested in.' },
  { cat: 'Enrollment', q: 'Who can create an organization?', a: 'An authorized representative of the organization — typically a founder, HR lead or IT administrator with authority to register the company.' },
  { cat: 'Enrollment', q: 'Is company approval required?', a: 'Company administrator requests can be held for review before the account becomes active. Your enrollment may be subject to verification — confirm the exact steps with the team.' },
  { cat: 'Enrollment', q: 'How long does onboarding take?', a: 'It depends on verification and configuration for your organization. No fixed duration is guaranteed on this site; ask the HR MAX team for the current timeline.', link: { label: 'How it works', to: '/how-it-works' } },
  { cat: 'Enrollment', q: 'How do I invite employees?', a: 'Once your organization is configured, administrators create employee records and issue access according to each person’s role.' },
  { cat: 'Enrollment', q: 'What happens after submitting the enrollment form?', a: 'You receive a confirmation of the request, then follow-up instructions. Any required verification is completed before configuration begins.' },

  // Attendance
  { cat: 'Attendance', q: 'How does attendance tracking work?', a: 'Employees check in and check out from the app. The server validates the request against your configured policy before storing the record.' },
  { cat: 'Attendance', q: 'Can employees check in and check out?', a: 'Yes — check-in and check-out are recorded from the app, with status derived from your shift timings and grace period.' },
  { cat: 'Attendance', q: 'Is GPS validation available?', a: 'Yes. Attendance can be restricted to an office location using a configurable geofence radius.' },
  { cat: 'Attendance', q: 'Are network restrictions supported?', a: 'Yes. Check-in can require a named office Wi-Fi network, or mobile data can be explicitly allowed, depending on your policy.' },
  { cat: 'Attendance', q: 'How are missed punches handled?', a: 'The employee raises a correction request within the configured correction window; a manager approves it before the record changes.' },

  // Leave
  { cat: 'Leave', q: 'How do employees request leave?', a: 'From the leave screen: select dates, add a reason and submit. It then appears in the approver’s queue.' },
  { cat: 'Leave', q: 'Who approves leave requests?', a: 'The manager or reviewer configured for that employee. Your exact routing depends on your organization setup.' },
  { cat: 'Leave', q: 'How are leave balances calculated?', a: 'Balances follow the policy configured for your organization. Confirm how accrual applies to your plan with the HR MAX team.' },
  { cat: 'Leave', q: 'Can administrators configure leave policies?', a: 'Leave policy configuration is available for administrators. Ask the team to confirm the options included in your plan.' },

  // Payroll
  { cat: 'Payroll', q: 'Does HR MAX support payroll?', a: 'Yes — payroll calculation, salary structures, salary slips and payroll history are part of the product.' },
  { cat: 'Payroll', q: 'Which payroll workflows are available?', a: 'Define salary structures, run a calculation for a period, review results, then generate per-employee salary slips.' },
  { cat: 'Payroll', q: 'Can payroll reports be exported?', a: 'Yes — payroll and salary data can be exported using the CSV and PDF export in the application.' },
  { cat: 'Payroll', q: 'How can an organization confirm payroll capabilities?', a: 'Ask for a walkthrough of payroll during your demo so you see the exact screens and limits that apply to your configuration.', link: { label: 'Book a demo', to: '/demo' } },

  // Security
  { cat: 'Security & Access', q: 'How are employee permissions managed?', a: 'Permissions are stored per role in a module-by-module matrix and evaluated on every authenticated request.' },
  { cat: 'Security & Access', q: 'What can an administrator access?', a: 'It depends on the role: a company administrator is scoped to their own organization, while a master administrator can operate across companies.' },
  { cat: 'Security & Access', q: 'Can access differ by role?', a: 'Yes. Roles carry different permission sets, and company-scoped roles are additionally limited to their own company’s data.' },
  { cat: 'Security & Access', q: 'How is employee information protected?', a: 'Access requires authentication, every request is authorized against the caller’s permissions, and sensitive actions are written to an audit trail. Request the full security overview from the team.', link: { label: 'Security overview', to: '/security' } },
  { cat: 'Security & Access', q: 'How can account access be changed?', a: 'An administrator can update roles, permissions and account status. Password changes go through a verified flow that records an audit event.' },

  // Billing & support
  { cat: 'Billing & Support', q: 'How is pricing determined?', a: 'By organization size and modules, confirmed directly by the HR MAX team. No public price list is published.', link: { label: 'Request pricing', to: '/pricing' } },
  { cat: 'Billing & Support', q: 'Which payment methods are supported?', a: 'Confirmed by the HR MAX team during the sales conversation. This site does not process payments.' },
  { cat: 'Billing & Support', q: 'Is a demo available?', a: 'Yes — you can view the product demo or request a personalized session.', link: { label: 'Book a demo', to: '/demo' } },
  { cat: 'Billing & Support', q: 'How can a customer contact support?', a: 'Use the contact form and choose a support enquiry. The team responds through the business email you provide.', link: { label: 'Contact support', to: '/contact' } },
  { cat: 'Billing & Support', q: 'How can an organization request assistance?', a: 'Submit a support request through the contact page with your organization name and a description of the issue.' },
  { cat: 'Billing & Support', q: 'How can a customer request account or data deletion?', a: 'Use the account deletion request page. Requests are handled according to the privacy policy.', link: { label: 'Delete account', to: '/delete-account' } },
]

const categories: Array<Category | 'All'> = ['All', 'Product', 'Enrollment', 'Attendance', 'Leave', 'Payroll', 'Security & Access', 'Billing & Support']

export function Faq() {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<(typeof categories)[number]>('All')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return faqs.filter(f => {
      const catOk = cat === 'All' || f.cat === cat
      const qOk = !q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)
      return catOk && qOk
    })
  }, [query, cat])

  return (
    <PageShell
      title="HR MAX FAQ — Product, Enrollment, Attendance, Payroll & Security"
      description="Answers to the most common questions about HR MAX: what it does, how enrollment works, attendance rules, leave approvals, payroll, permissions, pricing and support."
      eyebrow="Help centre"
      h1="Frequently Asked Questions"
      lede="Searchable answers about the product, onboarding and policies. Where a policy is not published here, we say so rather than guess."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'FAQ' }]}
      ctaHeading="Still Have a Question?"
      ctaText="Ask the HR MAX team directly — they will confirm anything this page does not cover."
    >
      <section className="faq-controls" aria-label="Filter questions">
        <div className="faq-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search questions…"
            aria-label="Search frequently asked questions"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="faq-chips" role="group" aria-label="Question categories">
          {categories.map(c => (
            <button
              key={c}
              type="button"
              className={cat === c ? 'is-active' : ''}
              aria-pressed={cat === c}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      <p className="faq-count" role="status" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? 'question' : 'questions'}
        {cat !== 'All' && ` in ${cat}`}
        {query && ` matching “${query}”`}
      </p>

      {filtered.length === 0 ? (
        <div className="faq-empty">
          <p>No questions match your search.</p>
          <button type="button" className="hero-btn-secondary" onClick={() => { setQuery(''); setCat('All') }}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="doc-faq faq-list">
          {filtered.map(f => (
            <details key={f.q}>
              <summary>
                <span>{f.q}</span>
                <span className="faq-tag">{f.cat}</span>
              </summary>
              <p>{f.a}</p>
              {f.link && (
                <Link to={f.link.to} className="doc-card-cta">
                  {f.link.label} <ChevronRight size={14} aria-hidden="true" />
                </Link>
              )}
            </details>
          ))}
        </div>
      )}
    </PageShell>
  )
}
