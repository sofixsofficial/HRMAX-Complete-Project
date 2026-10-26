import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, ArrowRight } from 'lucide-react'
import { Seo } from '../../components/Seo'
import { ORIGIN, routeTitles } from './site-nav'
import './PageShell.css'

interface Crumb {
  label: string
  to?: string
}

interface PageShellProps {
  /** Page title — also drives the document title, meta and breadcrumbs. */
  title: string
  /** Meta description (unique per page). */
  description: string
  /** Eyebrow shown above the H1, e.g. "Employee Management". */
  eyebrow?: string
  /** The single H1 for the page. Falls back to `title`. */
  h1?: string
  /** Short supporting paragraph under the H1. */
  lede?: string
  /** Overrides the auto-derived breadcrumb trail. */
  breadcrumbs?: Crumb[]
  /** Hide the bottom conversion band (used on legal pages). */
  hideCta?: boolean
  ctaHeading?: string
  ctaText?: string
  children: ReactNode
}

/** Builds `/modules/attendance` -> Home / Modules / Attendance */
function autoCrumbs(pathname: string): Crumb[] {
  const parts = pathname.split('/').filter(Boolean)
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }]
  let acc = ''
  parts.forEach((p, i) => {
    acc += `/${p}`
    const label = routeTitles[acc] ?? p.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    crumbs.push(i === parts.length - 1 ? { label } : { label, to: acc })
  })
  return crumbs
}

export function PageShell({
  title,
  description,
  eyebrow,
  h1,
  lede,
  breadcrumbs,
  hideCta = false,
  ctaHeading = 'Ready to Bring Your HR Operations Together?',
  ctaText = 'Explore HR MAX and discover a more organized way to manage your workforce.',
  children,
}: PageShellProps) {
  const { pathname } = useLocation()
  const crumbs = breadcrumbs ?? autoCrumbs(pathname)
  const url = `${ORIGIN}${pathname === '/' ? '/' : pathname}`

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      item: c.to ? `${ORIGIN}${c.to === '/' ? '/' : c.to}` : url,
    })),
  }

  return (
    <div className="page-shell">
      <Seo
        title={title}
        description={description}
        path={pathname}
        breadcrumbs={crumbs.map(c => c.label)}
      />
      <script type="application/ld+json">{JSON.stringify(breadcrumbSchema)}</script>

      <header className="page-hero">
        <div className="page-hero-inner">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <ol>
              {crumbs.map((c, i) => (
                <li key={i}>
                  {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
                  {i < crumbs.length - 1 && <ChevronRight size={14} aria-hidden="true" />}
                </li>
              ))}
            </ol>
          </nav>

          {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
          <h1>{h1 ?? title}</h1>
          {lede && <p className="page-lede">{lede}</p>}
        </div>
      </header>

      <main className="page-body" id="main">
        {children}
      </main>

      {!hideCta && (
        <section className="page-cta" aria-labelledby="page-cta-heading">
          <div className="page-cta-inner">
            <h2 id="page-cta-heading">{ctaHeading}</h2>
            <p>{ctaText}</p>
            <div className="page-cta-actions">
              <Link to="/enroll" className="hero-btn-primary">
                Get Started <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link to="/contact" className="hero-btn-secondary">
                Talk to Our Team
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
