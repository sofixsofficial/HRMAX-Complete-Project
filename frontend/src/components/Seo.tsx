import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Per-route meta for this SPA.
 *
 * Vite serves ONE index.html for every URL, so without this every route would
 * carry the identical <title>/description/canonical — Google would see dozens
 * of "duplicate" pages and rank none of them. Google renders JS, so updating
 * the head client-side gives each public page its own title, description,
 * canonical and Open Graph tags.
 *
 * Public pages are indexed; everything behind login gets noindex,nofollow so
 * crawl budget isn't wasted on app screens that no search engine can see.
 */

const ORIGIN = 'https://www.hrmax.in'

interface PageMeta {
  title: string
  description: string
}

/** Only these routes are public/valuable to search engines. */
const PUBLIC_PAGES: Record<string, PageMeta> = {
  '/': {
    title: 'HR MAX - HR Management Platform | Payroll, Attendance & HR Software',
    description:
      'HR MAX is an all-in-one HR management platform: employee records, attendance, leave, payroll, tasks, reports and analytics for growing companies.',
  },
  '/features': {
    title: 'Features - HR MAX | Attendance, Payroll, Leave & Employee Management',
    description:
      'Explore HR MAX features: multi-company management, role-based access, automated payroll, geofence attendance, leave workflow, tasks and real-time HR analytics.',
  },
  '/about': {
    title: 'About HR MAX - All-in-One HR Management Platform',
    description:
      'HR MAX helps companies run HR end to end — hiring, attendance, payroll and reporting — from a single dashboard built for teams of every size.',
  },
  '/contact': {
    title: 'Contact HR MAX - HR Software Sales & Support Enquiry',
    description:
      'Get in touch with the HR MAX team for sales, onboarding, pricing or support. We reply within 24 hours.',
  },
  '/register': {
    title: 'Corporate Inquiry - Request a Demo | HR MAX',
    description:
      'Submit a corporate inquiry for HR MAX and our team will contact you within 24 hours to plan your HR, payroll and attendance rollout.',
  },
  '/login': {
    title: 'Sign In - HR MAX',
    description: 'Sign in to your HR MAX account to manage employees, attendance, payroll and reports.',
  },
  '/forgot-password': {
    title: 'Reset Password - HR MAX',
    description: 'Reset your HR MAX account password securely by email.',
  },
  '/privacy': {
    title: 'Privacy Policy - HR MAX',
    description: 'How HR MAX collects, stores and protects your personal and company data.',
  },
  '/delete-account': {
    title: 'Delete Account - HR MAX',
    description: 'Permanently remove your HR MAX account and associated personal data.',
  },
}

const DEFAULT_APP_META: PageMeta = {
  title: 'HR MAX',
  description: 'HR MAX management dashboard.',
}

const upsertMeta = (attr: 'name' | 'property', key: string, content: string): void => {
  let node = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!node) {
    node = document.createElement('meta')
    node.setAttribute(attr, key)
    document.head.appendChild(node)
  }
  node.setAttribute('content', content)
}

const upsertLink = (rel: string, href: string): void => {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/** "/master-admin/employee-profile" -> "Employee Profile" */
const titleFromPath = (path: string): string => {
  const seg = path.split('/').filter(Boolean).pop() ?? ''
  if (!seg) return 'Dashboard'
  return seg
    .split('-')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

interface SeoProps {
  /** Overrides the route-map title. */
  title?: string
  /** Overrides the route-map description. */
  description?: string
  /** Canonical path (defaults to the current location). */
  path?: string
  /** Force indexability on/off; defaults to the public-route lookup. */
  index?: boolean
  breadcrumbs?: string[]
}

export function Seo({ title, description, path, index, breadcrumbs }: SeoProps = {}): null {
  const location = useLocation()

  useEffect(() => {
    const resolvedPath = (path ?? location.pathname).replace(/\/+$/, '') || '/'
    const page = PUBLIC_PAGES[resolvedPath]
    const isPublic = index ?? Boolean(page)

    const meta = {
      title: title ?? page?.title ?? `${titleFromPath(resolvedPath)} - HR MAX`,
      description: description ?? page?.description ?? DEFAULT_APP_META.description,
    }

    document.title = meta.title
    upsertMeta('name', 'description', meta.description)
    upsertMeta('name', 'robots', isPublic ? 'index, follow, max-image-preview:large' : 'noindex, nofollow')

    // Canonical drops the query string; app routes noindex anyway.
    upsertLink('canonical', `${ORIGIN}${resolvedPath === '/' ? '/' : resolvedPath}`)

    upsertMeta('property', 'og:title', meta.title)
    upsertMeta('property', 'og:description', meta.description)
    upsertMeta('property', 'og:url', `${ORIGIN}${resolvedPath === '/' ? '/' : resolvedPath}`)
    upsertMeta('property', 'og:type', 'website')
    upsertMeta('name', 'twitter:title', meta.title)
    upsertMeta('name', 'twitter:description', meta.description)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, title, description, path, index])

  return null
}
