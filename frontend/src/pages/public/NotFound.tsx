import { Link } from 'react-router-dom'
import { SearchX, ArrowRight } from 'lucide-react'
import { Seo } from '../../components/Seo'
import { mainNav } from './site-nav'
import './NotFound.css'

/**
 * 404 page. NOTE: this is a client-side catch-all inside an SPA, so the server
 * cannot return a true HTTP 404 for unknown paths — CloudFront serves
 * index.html for every unknown route. Rendering this view is the practical
 * equivalent; a server-side custom-error configuration would be needed for a
 * literal 404 status.
 */
export function NotFound() {
  return (
    <div className="notfound">
      <Seo title="Page Not Found — HR MAX" description="The page you are looking for does not exist." path="/404" index={false} />
      <div className="notfound-card">
        <div className="notfound-icon" aria-hidden="true">
          <SearchX size={34} />
        </div>
        <p className="notfound-code">404</p>
        <h1>Page not found</h1>
        <p className="notfound-text">
          The page you are looking for may have moved or never existed. Try one of these instead.
        </p>

        <div className="notfound-actions">
          <Link to="/" className="hero-btn-primary">
            Back to Home <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link to="/contact" className="hero-btn-secondary">
            Contact Support
          </Link>
        </div>

        <nav className="notfound-links" aria-label="Popular pages">
          {mainNav.filter(g => g.items).map(g => (
            <div key={g.label}>
              <h2>{g.label}</h2>
              <ul>
                {g.items!.slice(0, 4).map(i =>
                  i.external ? (
                    <li key={i.to}>
                      <a href={i.to}>{i.label}</a>
                    </li>
                  ) : (
                    <li key={i.to}>
                      <Link to={i.to}>{i.label}</Link>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </div>
  )
}
