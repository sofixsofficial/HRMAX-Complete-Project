import { Link } from 'react-router-dom'
import { Mail, Phone, MapPin } from 'lucide-react'
import { Logo } from '../../components/Logo'
import { footerNav } from './site-nav'
import './Footer.css'

/**
 * Verified business contact details, reused from the existing Contact page.
 * No social links are rendered: none are verified in the source project, and
 * a placeholder `#` link is worse than no link at all.
 */
const contact = [
  { icon: Mail, label: 'info@hrmax.in', href: 'mailto:info@hrmax.in' },
  { icon: Phone, label: '+91 96015 82622', href: 'tel:+919601582622' },
  { icon: MapPin, label: 'Surat, Gujarat, India', href: null },
]

export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-grid">
          <div className="site-footer-brand">
            <Link to="/" aria-label="HR MAX home" className="site-footer-logo">
              <Logo variant="compact" size="md" onLight />
            </Link>
            <p>
              HR MAX is the human resource management system from Sofixs — employee records,
              attendance, leave, payroll, tasks and reporting in one connected workspace.
            </p>
            <ul className="site-footer-contact">
              {contact.map(c => {
                const inner = (
                  <>
                    <c.icon size={15} aria-hidden="true" />
                    <span>{c.label}</span>
                  </>
                )
                return (
                  <li key={c.label}>
                    {c.href ? (
                      <a href={c.href}>{inner}</a>
                    ) : (
                      <span className="is-static">{inner}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          {footerNav.map(group => (
            <nav key={group.label} className="site-footer-col" aria-label={group.label}>
              <h2>{group.label}</h2>
              <ul>
                {group.items!.map(item =>
                  item.external ? (
                    <li key={item.to}>
                      <a href={item.to}>{item.label}</a>
                    </li>
                  ) : (
                    <li key={item.to}>
                      <Link to={item.to}>{item.label}</Link>
                    </li>
                  )
                )}
              </ul>
            </nav>
          ))}
        </div>

        <div className="site-footer-bottom">
          <p>
            © {year} HR MAX by Sofixs. All rights reserved.
          </p>
          <p className="site-footer-note">
            Product screenshots and demo content are illustrative and contain no real employee data.
          </p>
        </div>
      </div>
    </footer>
  )
}
