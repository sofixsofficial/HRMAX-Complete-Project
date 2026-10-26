/**
 * Single source of truth for the public site's information architecture.
 *
 * Consumed by <Navbar/>, <Footer/>, breadcrumbs and the XML sitemap so a link
 * can never be added in one place and forgotten in another.
 *
 * RULE: every `to` must be a real, registered route in App.tsx. No `#`
 * placeholders, no dead ends — the marketing site previously shipped 12 dead
 * footer links, which hurt both UX and crawl quality.
 */

export interface NavLeaf {
  label: string
  to: string
  /** One-line descriptor shown in mega-menu panels. */
  desc?: string
  /**
   * True for real static files (e.g. the standalone article) that must load
   * via a full document request — a client-side <Link> would resolve to the
   * SPA's catch-all 404 instead of the file.
   */
  external?: boolean
}

export interface NavGroup {
  label: string
  /** Plain link (no dropdown) when `items` is omitted. */
  to?: string
  items?: NavLeaf[]
  /** Optional footer-only blurb for the group. */
  intro?: string
}

export const ORIGIN = 'https://www.hrmax.in'

/** Primary navigation (desktop). */
export const mainNav: NavGroup[] = [
  {
    label: 'Product',
    to: '/modules',
    intro: 'Every HR MAX module, what it does and who it is for.',
    items: [
      { label: 'Employee Management', to: '/modules/employee-management', desc: 'Profiles, records and reporting hierarchy' },
      { label: 'Attendance & Time', to: '/modules/attendance', desc: 'Check-in/out, geofence and Wi-Fi rules' },
      { label: 'Leave Management', to: '/modules/leave-management', desc: 'Requests, approvals and balances' },
      { label: 'Payroll', to: '/modules/payroll', desc: 'Salary structures and payroll runs' },
      { label: 'Task Management', to: '/modules/task-management', desc: 'Assign work and track progress' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics', desc: 'Workforce reporting and exports' },
      { label: 'Organization & Access', to: '/modules/organization-management', desc: 'Companies, departments, roles' },
    ],
  },
  {
    label: 'Solutions',
    to: '/solutions',
    intro: 'How teams of different shapes run HR on HR MAX.',
    items: [
      { label: 'Small Businesses', to: '/solutions/small-business', desc: 'Get off spreadsheets quickly' },
      { label: 'Growing Companies', to: '/solutions/enterprise', desc: 'Structured HR as headcount grows' },
      { label: 'HR Teams', to: '/solutions/hr-teams', desc: 'Policy, approvals and reporting' },
      { label: 'Distributed Teams', to: '/solutions/remote-teams', desc: 'Attendance for hybrid workforces' },
    ],
  },
  {
    label: 'Resources',
    to: '/how-it-works',
    intro: 'See how HR MAX works and get help.',
    items: [
      { label: 'How It Works', to: '/how-it-works', desc: 'Four steps from signup to daily use' },
      { label: 'HR MAX Guide', to: '/hr-max-by-sofixs-hr-payroll-management.html', desc: 'Long-form guide to the platform', external: true },
      { label: 'Product Demo', to: '/demo', desc: 'Guided product walkthrough' },
      { label: 'FAQs', to: '/faq', desc: 'Product, enrollment, billing answers' },
      { label: 'Security', to: '/security', desc: 'How access and data are protected' },
      { label: 'Help & Support', to: '/contact', desc: 'Talk to the HR MAX team' },
    ],
  },
  { label: 'Pricing', to: '/pricing' },
  {
    label: 'Company',
    to: '/about',
    items: [
      { label: 'About HR MAX', to: '/about', desc: 'HR MAX and Sofixs — who builds it' },
      { label: 'Contact', to: '/contact', desc: 'Sales, support and general enquiries' },
      { label: 'Enroll Your Organization', to: '/enroll', desc: 'Start the onboarding request' },
    ],
  },
]

/** Footer link groups — same source as the navbar so nothing drifts. */
export const footerNav: NavGroup[] = [
  {
    label: 'Product',
    items: [
      { label: 'All Modules', to: '/modules' },
      { label: 'Employee Management', to: '/modules/employee-management' },
      { label: 'Attendance', to: '/modules/attendance' },
      { label: 'Leave Management', to: '/modules/leave-management' },
      { label: 'Payroll', to: '/modules/payroll' },
      { label: 'Reports & Analytics', to: '/modules/reports-analytics' },
      { label: 'Solutions', to: '/solutions' },
      { label: 'Pricing', to: '/pricing' },
    ],
  },
  {
    label: 'Resources',
    items: [
      { label: 'How It Works', to: '/how-it-works' },
      { label: 'HR MAX Guide', to: '/hr-max-by-sofixs-hr-payroll-management.html', external: true },
      { label: 'Product Demo', to: '/demo' },
      { label: 'FAQs', to: '/faq' },
      { label: 'Security', to: '/security' },
      { label: 'Help & Support', to: '/contact' },
    ],
  },
  {
    label: 'Company',
    items: [
      { label: 'About HR MAX', to: '/about' },
      { label: 'Contact', to: '/contact' },
      { label: 'Book a Demo', to: '/demo' },
      { label: 'Enroll Your Organization', to: '/enroll' },
    ],
  },
  {
    label: 'Legal',
    items: [
      { label: 'Privacy Policy', to: '/privacy' },
      { label: 'Terms & Conditions', to: '/terms-and-conditions' },
      { label: 'Account Deletion', to: '/delete-account' },
    ],
  },
]

/** Breadcrumb fallback labels for application routes (public pages only). */
export const routeTitles: Record<string, string> = {
  '/': 'Home',
  '/features': 'Features',
  '/modules': 'Modules',
  '/solutions': 'Solutions',
  '/how-it-works': 'How It Works',
  '/pricing': 'Pricing',
  '/demo': 'Demo',
  '/enroll': 'Enroll',
  '/contact': 'Contact',
  '/about': 'About',
  '/faq': 'FAQ',
  '/security': 'Security',
  '/privacy': 'Privacy Policy',
  '/terms-and-conditions': 'Terms & Conditions',
  '/login': 'Sign In',
  '/register': 'Corporate Inquiry',
  '/forgot-password': 'Reset Password',
}
