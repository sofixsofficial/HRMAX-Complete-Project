import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowRight, CheckCircle2, HelpCircle } from 'lucide-react'
import { PageShell } from './PageShell'
import { moduleBySlug, modules } from './modules-content'

/**
 * Renders a single module documentation page from data, so every module gets
 * an identical, predictable structure (problem -> workflow -> capabilities ->
 * audience -> FAQ) without 7 near-identical copy-pasted components.
 */
export function ModulePage() {
  const { slug = '' } = useParams()
  const mod = moduleBySlug(slug)

  // Unknown slug -> 404 rather than a blank page.
  if (!mod) return <Navigate to="/404" replace />

  return (
    <PageShell
      title={`${mod.h1} — HR MAX Module`}
      description={mod.lede}
      eyebrow={mod.eyebrow}
      h1={mod.h1}
      lede={mod.lede}
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Modules', to: '/modules' }, { label: mod.navLabel }]}
      ctaHeading={`See ${mod.navLabel} in HR MAX`}
      ctaText="Walk through this module with the live product, or start an enrollment request for your organization."
    >
      {/* The problem it solves */}
      <section className="doc-section" aria-labelledby="problem-heading">
        <h2 id="problem-heading">The problem it solves</h2>
        <p className="doc-lede">{mod.problem}</p>
      </section>

      {/* Workflow */}
      <section className="doc-section" aria-labelledby="workflow-heading">
        <h2 id="workflow-heading">How the workflow runs</h2>
        <ol className="doc-steps">
          {mod.workflow.map((step, i) => (
            <li key={i}>
              <span className="doc-step-num" aria-hidden="true">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Capabilities */}
      <section className="doc-section" aria-labelledby="capabilities-heading">
        <h2 id="capabilities-heading">Key capabilities</h2>
        <div className="doc-grid">
          {mod.capabilities.map(c => (
            <article key={c.title} className="doc-card">
              <h3>
                <CheckCircle2 size={17} aria-hidden="true" />
                {c.title}
              </h3>
              <p>{c.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Audience */}
      <section className="doc-callout" aria-labelledby="audience-heading">
        <h2 id="audience-heading">Who benefits</h2>
        <p>{mod.whoBenefits}</p>
      </section>

      {/* Related */}
      <section className="doc-section" aria-labelledby="related-heading">
        <h2 id="related-heading">Related in HR MAX</h2>
        <div className="doc-related">
          {mod.related.map(r => (
            <Link key={r.to} to={r.to} className="doc-related-link">
              {r.label} <ArrowRight size={15} aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="doc-section" aria-labelledby="faq-heading">
        <h2 id="faq-heading">
          <HelpCircle size={19} aria-hidden="true" /> Common questions
        </h2>
        <div className="doc-faq">
          {mod.faqs.map(f => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <p className="doc-all-modules">
        <Link to="/modules">Browse all {modules.length} HR MAX modules</Link>
      </p>
    </PageShell>
  )
}

/** `/modules` index. */
export function ModulesIndex() {
  return (
    <PageShell
      title="HR MAX Modules — Employee, Attendance, Leave, Payroll and More"
      description="Every module included in the HR MAX human resource management system: employee records, attendance, leave, payroll, tasks, reporting and access control."
      eyebrow="Product"
      h1="HR MAX Modules"
      lede="One connected platform for the HR operations your organization runs every day. Each module works on the same employee records, so nothing has to be entered twice."
      breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Modules' }]}
      ctaHeading="Ready to See the Modules Together?"
      ctaText="A guided demo shows how these modules connect across a real organization."
    >
      <section className="doc-section" aria-labelledby="module-list-heading">
        <h2 id="module-list-heading">What is included</h2>
        <div className="doc-grid">
          {modules.map(m => (
            <article key={m.slug} className="doc-card doc-card-link">
              <h3>
                <Link to={`/modules/${m.slug}`}>{m.navLabel}</Link>
              </h3>
              <p>{m.lede}</p>
              <Link className="doc-card-cta" to={`/modules/${m.slug}`}>
                Explore module <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="doc-callout" aria-labelledby="coverage-heading">
        <h2 id="coverage-heading">What HR MAX does not claim</h2>
        <p>
          HR MAX covers the modules documented above. It does not advertise integrations,
          certifications, applicant tracking or benefits administration that are not part of
          the product. If a capability matters to your evaluation, ask the HR MAX team to
          confirm it before you enroll.
        </p>
      </section>
    </PageShell>
  )
}
