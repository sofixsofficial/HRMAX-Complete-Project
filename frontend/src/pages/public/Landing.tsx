import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Users, Building2, Shield, BarChart3,
  Clock, Globe, CheckSquare, BookOpen, Mail, Phone, MapPin
} from 'lucide-react'
import './Landing.css'

const features = [
  { icon: Users, title: 'Employee Management', desc: 'Complete employee lifecycle from onboarding to offboarding.', color: '#f97316' },
  { icon: Clock, title: 'Attendance & Time', desc: 'Real-time tracking, geo-fencing, and automated timesheets.', color: '#10b981' },
  { icon: Building2, title: 'Multi-Company', desc: 'Manage multiple organizations from a single dashboard.', color: '#f59e0b' },
  { icon: Shield, title: 'Access Control', desc: 'Granular permissions with role-based access for all levels.', color: '#ef4444' },
  { icon: BarChart3, title: 'Analytics & Reports', desc: 'Powerful dashboards with customizable reports.', color: '#8b5cf6' },
  { icon: Globe, title: 'Global Payroll', desc: 'Multi-currency payroll with tax compliance.', color: '#06b6d4' },
  { icon: CheckSquare, title: 'Task Management', desc: 'Assign and track tasks across your organization.', color: '#22c55e' },
  { icon: BookOpen, title: 'Employee Directory', desc: 'Centralized address book with quick search.', color: '#6366f1' },
]

function ScrollReveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} className={`${className}`} style={{ opacity: visible ? 1 : 0, transform: visible ? 'translateY(0)' : 'translateY(30px)', transition: 'all 0.6s ease' }}>
      {children}
    </div>
  )
}

export function Landing() {
  return (
    <div className="landing-page">
      <section className="hero-section">
        <div className="hero-content">
          <div className="hero-left">
            <h1>
              Transform Your Workforce<br />Management with <span>HR MAX</span>
            </h1>
            <p className="hero-subtitle">
              Manage Employees, Attendance, Leaves, Payroll, Tasks, Holidays
              and Performance from a Single Smart Platform.
            </p>
            <div className="hero-buttons">
              <Link to="/register" className="hero-btn-primary">
                Get Started <ArrowRight size={18} />
              </Link>
              <Link to="/contact" className="hero-btn-secondary">
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>

      <ScrollReveal>
        <section className="features-section">
          <div className="features-header">
            <h2>Everything You <span>Need</span></h2>
            <p>Powerful features designed to streamline every aspect of HR management.</p>
          </div>
          <div className="features-grid">
            {features.map(f => {
              const Icon = f.icon
              return (
                <div key={f.title} className="feature-card">
                  <div className="feature-card-icon" style={{ background: `${f.color}15`, color: f.color }}>
                    <Icon />
                  </div>
                  <h3>{f.title}</h3>
                  <p>{f.desc}</p>
                </div>
              )
            })}
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section className="contact-section-landing">
          <div className="contact-section-inner">
            <div className="contact-section-header">
              <h2>Get in <span>Touch</span></h2>
              <p>Ready to transform your HR operations? Reach out to us.</p>
            </div>
            <div className="contact-section-grid">
              <div className="contact-section-card">
                <div className="contact-section-card-icon">
                  <Phone size={22} />
                </div>
                <h3>Call Us</h3>
                <a href="tel:+919601582622">+91 96015 82622</a>
                <p>Mon-Fri, 9AM-6PM IST</p>
              </div>
              <div className="contact-section-card">
                <div className="contact-section-card-icon">
                  <Mail size={22} />
                </div>
                <h3>Email Us</h3>
                <a href="mailto:info@hrmax.in">info@hrmax.in</a>
                <p>We reply within 24 hours</p>
              </div>
              <div className="contact-section-card">
                <div className="contact-section-card-icon">
                  <MapPin size={22} />
                </div>
                <h3>Visit Us</h3>
                <p style={{ fontWeight: 500 }}>Surat, Gujarat, India</p>
                <p>Headquarters</p>
              </div>
            </div>
            <div className="contact-section-cta">
              <Link to="/contact" className="hero-btn-primary">
                Send us a Message <ArrowRight size={18} />
              </Link>
              <Link to="/register" className="hero-btn-secondary">
                Corporate Inquiry
              </Link>
            </div>
          </div>
        </section>
      </ScrollReveal>

      <section className="cta-section">
        <ScrollReveal>
          <h2>Ready to Get Started?</h2>
          <p>HR MAX — all-in-one HR management for your organization.</p>
          <div className="cta-buttons">
            <Link to="/register" className="hero-btn-primary">
              Start Free Trial <ArrowRight size={18} />
            </Link>
            <Link to="/contact" className="hero-btn-secondary">
              Contact Sales
            </Link>
          </div>
        </ScrollReveal>
      </section>
    </div>
  )
}
