import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X, ArrowRight, ChevronDown } from 'lucide-react'
import { Logo } from '../../components/Logo'
import { mainNav } from './site-nav'
import './Navbar.css'

/**
 * Public site navigation.
 *
 * - Fixed header that gains elevation once the page is scrolled.
 * - Center groups open as accessible dropdowns (button + aria-expanded,
 *   Escape to close, click-outside to close, arrow-key friendly focus).
 * - Below 960px the center/right collapse into a slide-out drawer.
 * - Active route is marked with aria-current so screen readers announce it.
 */
export function Navbar() {
  const [open, setOpen] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [drawerGroup, setDrawerGroup] = useState<string | null>(null)
  const location = useLocation()
  const navRef = useRef<HTMLElement>(null)

  // Close menus whenever the route changes.
  useEffect(() => {
    setOpen(null)
    setDrawer(false)
    setDrawerGroup(null)
  }, [location.pathname])

  // Elevation after scroll.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Click outside closes an open dropdown.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // Escape closes everything.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(null)
        setDrawer(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close the drawer when we cross into desktop layout.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 961px)')
    const onChange = () => {
      if (mq.matches) setDrawer(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname === to || location.pathname.startsWith(`${to}/`)

  const toggleGroup = (label: string) => setOpen(prev => (prev === label ? null : label))

  const onGroupKeyDown = (e: React.KeyboardEvent, label: string) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(label)
      // Move focus into the panel.
      requestAnimationFrame(() => {
        const first = navRef.current?.querySelector<HTMLAnchorElement>(`#menu-${cssId(label)} a`)
        first?.focus()
      })
    }
  }

  return (
    <nav
      ref={navRef}
      className={`site-nav ${scrolled ? 'is-scrolled' : ''}`}
      aria-label="Main"
    >
      <div className="site-nav-inner">
        <Link to="/" className="site-nav-logo" aria-label="HR MAX home">
          <Logo variant="compact" size="md" onLight />
        </Link>

        {/* Desktop centre links */}
        <ul className="site-nav-links">
          {mainNav.map(group => {
            if (!group.items) {
              return (
                <li key={group.label}>
                  <Link
                    to={group.to!}
                    className={`site-nav-link ${isActive(group.to!) ? 'is-active' : ''}`}
                    aria-current={isActive(group.to!) ? 'page' : undefined}
                  >
                    {group.label}
                  </Link>
                </li>
              )
            }

            const expanded = open === group.label
            const itemActive = group.items.some(i => isActive(i.to))
            const panelId = `menu-${cssId(group.label)}`
            const triggerId = `trigger-${cssId(group.label)}`

            return (
              <li key={group.label} className="site-nav-item">
                <button
                  id={triggerId}
                  type="button"
                  className={`site-nav-link site-nav-trigger ${itemActive ? 'is-active' : ''}`}
                  aria-expanded={expanded}
                  aria-haspopup="true"
                  aria-controls={panelId}
                  onClick={() => toggleGroup(group.label)}
                  onKeyDown={e => onGroupKeyDown(e, group.label)}
                >
                  {group.label}
                  <ChevronDown size={15} className={`caret ${expanded ? 'is-open' : ''}`} aria-hidden="true" />
                </button>

                {expanded && (
                  <div
                    id={panelId}
                    className="site-nav-panel"
                    role="menu"
                    aria-labelledby={triggerId}
                    onKeyDown={e => {
                      if (e.key === 'Escape') setOpen(null)
                    }}
                  >
                    {group.intro && <p className="site-nav-intro">{group.intro}</p>}
                    <ul>
                      {group.items.map(item =>
                        item.external ? (
                          <li key={item.to}>
                            {/* Full document request: the target is a static
                                file outside the SPA bundle. */}
                            <a href={item.to} role="menuitem" className="site-nav-panel-link">
                              <span className="panel-label">{item.label}</span>
                              {item.desc && <span className="panel-desc">{item.desc}</span>}
                            </a>
                          </li>
                        ) : (
                          <li key={item.to}>
                            <Link to={item.to} role="menuitem" className="site-nav-panel-link">
                              <span className="panel-label">{item.label}</span>
                              {item.desc && <span className="panel-desc">{item.desc}</span>}
                            </Link>
                          </li>
                        )
                      )}
                    </ul>
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {/* Desktop actions */}
        <div className="site-nav-actions">
          <Link to="/login" className="site-nav-login">
            Log in
          </Link>
          <Link to="/demo" className="site-nav-demo">
            Book a Demo
          </Link>
          <Link to="/enroll" className="site-nav-cta">
            Get Started <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="site-nav-burger"
          aria-expanded={drawer}
          aria-controls="mobile-drawer"
          aria-label={drawer ? 'Close menu' : 'Open menu'}
          onClick={() => setDrawer(v => !v)}
        >
          {drawer ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile slide-out drawer */}
      <div
        id="mobile-drawer"
        className={`site-drawer ${drawer ? 'is-open' : ''}`}
        hidden={!drawer}
        aria-label="Mobile navigation"
      >
        <div className="site-drawer-panel">
          <div className="site-drawer-head">
            <Link to="/" aria-label="HR MAX home">
              <Logo variant="compact" size="sm" onLight />
            </Link>
            <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="site-drawer-close">
              <X size={22} />
            </button>
          </div>

          <ul className="site-drawer-list">
            {mainNav.map(group => {
              if (!group.items) {
                return (
                  <li key={group.label}>
                    <Link
                      to={group.to!}
                      className={isActive(group.to!) ? 'is-active' : ''}
                      onClick={() => setDrawer(false)}
                    >
                      {group.label}
                    </Link>
                  </li>
                )
              }
              const expanded = drawerGroup === group.label
              return (
                <li key={group.label}>
                  <button
                    type="button"
                    className="site-drawer-trigger"
                    aria-expanded={expanded}
                    onClick={() => setDrawerGroup(expanded ? null : group.label)}
                  >
                    {group.label}
                    <ChevronDown size={16} className={`caret ${expanded ? 'is-open' : ''}`} aria-hidden="true" />
                  </button>
                  {expanded && (
                    <ul className="site-drawer-sub">
                      <li>
                        <Link to={group.to!} onClick={() => setDrawer(false)}>
                          All {group.label}
                        </Link>
                      </li>
                      {group.items.map(i => i.external ? (
                        <li key={i.to}>
                          <a href={i.to} onClick={() => setDrawer(false)}>{i.label}</a>
                        </li>
                      ) : (
                        <li key={i.to}>
                          <Link to={i.to} onClick={() => setDrawer(false)}>
                            {i.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="site-drawer-actions">
            <Link to="/login" className="site-nav-login" onClick={() => setDrawer(false)}>
              Log in
            </Link>
            <Link to="/demo" className="site-nav-demo" onClick={() => setDrawer(false)}>
              Book a Demo
            </Link>
            <Link to="/enroll" className="site-nav-cta" onClick={() => setDrawer(false)}>
              Get Started <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </nav>
  )
}

/** "Product" -> "Product", "How It Works" -> "How-It-Works" (stable DOM ids). */
function cssId(label: string): string {
  return label.replace(/[^a-zA-Z0-9]+/g, '-')
}
