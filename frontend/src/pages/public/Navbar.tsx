import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X, ArrowRight } from 'lucide-react'
import { Logo } from '../../components/Logo'

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  const links = [
    { to: '/', label: 'Home' },
    { to: '/features', label: 'Features' },
    { to: '/about', label: 'About' },
    { to: '/contact', label: 'Contact' },
  ]

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
      background: '#ffffff', borderBottom: '1px solid #f3f4f6'
    }}>
      <div style={{
        maxWidth: 1200, margin: '0 auto', padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 68
      }}>
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <Logo variant="compact" size="md" onLight />
        </Link>

        <div className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {links.map(l => (
            <Link key={l.to} to={l.to} style={{
              padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 500,
              color: location.pathname === l.to ? '#f97316' : '#6b7280',
              background: location.pathname === l.to ? '#fff7ed' : 'transparent',
              textDecoration: 'none', transition: 'all 0.2s'
            }}>
              {l.label}
            </Link>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link to="/login" style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: 500,
            color: '#374151', textDecoration: 'none', transition: 'all 0.2s'
          }}>
            Sign In
          </Link>
          <Link to="/register" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '10px 22px', borderRadius: 8, fontSize: 14, fontWeight: 600,
            color: '#fff', textDecoration: 'none', background: '#f97316',
            transition: 'all 0.2s'
          }}>
            Get Started <ArrowRight size={16} />
          </Link>
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          style={{ display: 'none', background: 'none', border: 'none', cursor: 'pointer', padding: 8, color: '#374151' }}
          className="mobile-menu-btn"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {mobileOpen && (
        <div style={{ padding: '16px 24px', borderTop: '1px solid #f3f4f6', background: '#fff' }}>
          {links.map(l => (
            <Link key={l.to} to={l.to} onClick={() => setMobileOpen(false)} style={{
              display: 'block', padding: '12px 0', fontSize: 15, fontWeight: 500,
              color: location.pathname === l.to ? '#f97316' : '#374151',
              textDecoration: 'none', borderBottom: '1px solid #f3f4f6'
            }}>
              {l.label}
            </Link>
          ))}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Link to="/login" onClick={() => setMobileOpen(false)} style={{
              flex: 1, padding: '12px', borderRadius: 8, fontSize: 14, fontWeight: 600,
              color: '#374151', textDecoration: 'none', border: '1px solid #e5e7eb',
              textAlign: 'center'
            }}>
              Sign In
            </Link>
            <Link to="/register" onClick={() => setMobileOpen(false)} style={{
              flex: 1, padding: '12px', borderRadius: 8, fontSize: 14, fontWeight: 600,
              color: '#fff', textDecoration: 'none', background: '#f97316',
              textAlign: 'center'
            }}>
              Get Started
            </Link>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .nav-links { display: none !important; }
          .mobile-menu-btn { display: flex !important; }
        }
      `}</style>
    </nav>
  )
}
