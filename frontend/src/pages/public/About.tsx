import { Link } from 'react-router-dom'
import { Users, Target, Heart, Award, ArrowRight, Shield } from 'lucide-react'

const values = [
  { icon: Heart, title: 'People First', desc: 'Great technology empowers people. Every feature puts the human experience first.', color: '#ef4444' },
  { icon: Target, title: 'Innovation Driven', desc: 'Constantly pushing boundaries with AI and automation to eliminate busywork.', color: '#f97316' },
  { icon: Shield, title: 'Trust & Security', desc: 'Bank-grade security standards across all our platforms.', color: '#10b981' },
  { icon: Award, title: 'Excellence Always', desc: 'Highest standards of quality, support, and reliability.', color: '#f59e0b' },
]

export function About() {
  return (
    <div style={{ background: '#fff', color: '#111827', minHeight: '100vh', paddingTop: 68 }}>
      <section style={{ padding: '64px 24px', textAlign: 'center', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 16, color: '#111827' }}>
            Our Mission: Make HR <span style={{ color: '#f97316' }}>Simple</span>
          </h1>
          <p style={{ fontSize: 16, color: '#6b7280', lineHeight: 1.7 }}>
            Building the future of workforce management — helping companies take care of their people.
          </p>
        </div>
      </section>

      <section style={{ padding: '64px 24px', maxWidth: 700, margin: '0 auto' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 16, textAlign: 'center' }}>Our Story</h2>
        <div style={{ color: '#6b7280', fontSize: 15, lineHeight: 1.8, textAlign: 'center' }}>
          <p style={{ marginBottom: 16 }}>Founded in 2020 by HR tech veterans who saw how fragmented HR tools were.</p>
          <p style={{ marginBottom: 16 }}>After watching enterprises juggle 5+ systems for payroll, attendance, and hiring, they built something better.</p>
        </div>
      </section>

      <section style={{ padding: '64px 24px', background: '#f9fafb', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 40, textAlign: 'center' }}>Our <span style={{ color: '#f97316' }}>Values</span></h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {values.map(v => {
              const Icon = v.icon
              return (
                <div key={v.title} style={{ padding: 28, borderRadius: 12, background: '#fff', border: '1px solid #f3f4f6' }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: `${v.color}15`, color: v.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                    <Icon size={22} />
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{v.title}</h3>
                  <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6 }}>{v.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section style={{ padding: '64px 24px', textAlign: 'center', background: '#fff7ed', borderTop: '1px solid #f3f4f6' }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Join Our Team</h2>
        <p style={{ color: '#6b7280', fontSize: 15, marginBottom: 24 }}>We're always looking for talented people.</p>
        <Link to="/contact" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600, color: '#fff', textDecoration: 'none', background: '#f97316' }}>
          Contact Us <ArrowRight size={16} />
        </Link>
      </section>
    </div>
  )
}
