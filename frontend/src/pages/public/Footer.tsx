import { Link } from 'react-router-dom'
import { Mail, Phone, MapPin, Play } from 'lucide-react'
import { Logo } from '../../components/Logo'
import { footerNav, PLAY_STORE_URL } from './site-nav'
import { FacebookIcon, InstagramIcon, YoutubeIcon } from './social-icons'
import './Footer.css'

/**
 * Verified business contact details, reused from the existing Contact page,
 * plus the official HR MAX social profiles (verified links — never `#`).
 */
const contact = [
  { icon: Mail, label: 'info@hrmax.in', href: 'mailto:info@hrmax.in' },
  { icon: Phone, label: '+91 96015 82622', href: 'tel:+919601582622' },
  { icon: MapPin, label: 'Surat, Gujarat, India', href: null },
]

const socials = [
  { icon: FacebookIcon, label: 'HR MAX on Facebook', href: 'https://www.facebook.com/profile.php?id=61596110247952' },
  { icon: InstagramIcon, label: 'HR MAX on Instagram', href: 'https://www.instagram.com/hr.maxx/' },
  { icon: YoutubeIcon, label: 'HR MAX on YouTube', href: 'https://www.youtube.com/channel/UCc3PMO4Dufc-iXOnpsDm1PA' },
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

            <ul className="site-footer-social" aria-label="HR MAX on social media">
              {socials.map(s => (
                <li key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label} title={s.label}>
                    <s.icon size={18} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>

            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="site-footer-store"
              aria-label="Get HR MAX on Google Play"
            >
              <Play size={15} fill="currentColor" aria-hidden="true" />
              Get it on Google Play
            </a>
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
            HR MAX — the all-in-one HR management platform for people, attendance, leave and
            payroll. Powered by Sofixs.
          </p>
        </div>
      </div>
    </footer>
  )
}
