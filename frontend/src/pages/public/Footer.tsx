import { Link } from 'react-router-dom'
import { Mail, Phone, MapPin, Globe, MessageSquare, Share2, Play } from 'lucide-react'
import { Logo } from '../../components/Logo'

const sections = [
  {
    title: 'Product',
    links: [
      { label: 'Features', to: '/features' },
      { label: 'Integrations', to: '#' },
      { label: 'API', to: '#' },
      { label: 'Changelog', to: '#' },
    ]
  },
  {
    title: 'Company',
    links: [
      { label: 'About', to: '/about' },
      { label: 'Contact', to: '/contact' },
      { label: 'Careers', to: '#' },
      { label: 'Blog', to: '#' },
    ]
  },
  {
    title: 'Support',
    links: [
      { label: 'Help Center', to: '#' },
      { label: 'Documentation', to: '#' },
      { label: 'Status', to: '#' },
      { label: 'Security', to: '#' },
    ]
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', to: '/privacy' },
      { label: 'Terms', to: '#' },
      { label: 'Cookies', to: '#' },
      { label: 'GDPR', to: '#' },
    ]
  },
]

const socialLinks = [
  { icon: Globe, href: '#', label: 'Website' },
  { icon: MessageSquare, href: '#', label: 'Community' },
  { icon: Share2, href: '#', label: 'Social' },
  { icon: Play, href: '#', label: 'Tutorials' },
]

export function Footer() {
  return (
    <footer style={{
      background: '#f9fafb', color: '#111827',
      borderTop: '1px solid #f3f4f6'
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px 0' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
          gap: 48, paddingBottom: 48
        }}>
          <div>
            <div style={{ marginBottom: 16 }}>
              <Logo variant="compact" size="md" onLight />
            </div>
            <p style={{ color: '#4b5563', fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
              HR MAX — all-in-one HR management platform for businesses of all sizes. 
              Streamline your workforce operations with our all-in-one solution.
            </p>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {socialLinks.map(s => {
                const Icon = s.icon
                return (
                  <a key={s.label} href={s.href} aria-label={s.label} style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: '#f3f4f6', color: '#6b7280',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.2s', textDecoration: 'none'
                  }}>
                    <Icon size={16} />
                  </a>
                )
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <a href="mailto:info@hrmax.in" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>
                <Mail size={16} /> info@hrmax.in
              </a>
              <a href="tel:+919601582622" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#6b7280', fontSize: 14, textDecoration: 'none' }}>
                <Phone size={16} /> +91 96015 82622
              </a>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#6b7280', fontSize: 14 }}>
                <MapPin size={16} /> Surat, Gujarat, India
              </div>
            </div>
          </div>
          {sections.map(s => (
            <div key={s.title}>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 20, color: '#111827' }}>{s.title}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {s.links.map(l => (
                  <Link key={l.label} to={l.to} style={{
                    color: '#6b7280', textDecoration: 'none', fontSize: 14, transition: 'color 0.2s'
                  }}>
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{
          borderTop: '1px solid #f3f4f6',
          padding: '20px 0', display: 'flex', justifyContent: 'space-between',
          color: '#6b7280', fontSize: 13, flexWrap: 'wrap', gap: 8
        }}>
          <span>&copy; {new Date().getFullYear()} HR MAX. All rights reserved.</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Powered by{' '}
            <a
              href="https://www.sofixs.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#FF6600', fontWeight: 700, textDecoration: 'none',
                letterSpacing: 0.3,
              }}
            >
              Sofixs
            </a>
          </span>
          <span>Made with care for modern workplaces.</span>
        </div>
      </div>
    </footer>
  )
}
