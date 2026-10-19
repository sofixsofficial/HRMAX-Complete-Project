import { Link } from 'react-router-dom'
import { 
  ArrowRight, CheckCircle, Users, Building2, Shield, BarChart3, 
  Clock, Globe, Bell, FileText, MessageSquare, Calendar, BookOpen, Briefcase, Star
} from 'lucide-react'

const categories = [
  {
    title: 'Core HR', color: '#f97316',
    items: [
      { icon: Users, title: 'Employee Management', desc: 'Complete lifecycle with digital profiles, documents, and history.' },
      { icon: Building2, title: 'Multi-Company', desc: 'Manage multiple organizations from a single dashboard.' },
      { icon: BookOpen, title: 'Address Booklet', desc: 'Centralized directory with all employee contacts.' },
      { icon: Star, title: 'Birthday Tracker', desc: 'Automatic celebration reminders and recognition.' },
    ]
  },
  {
    title: 'Time & Attendance', color: '#10b981',
    items: [
      { icon: Clock, title: 'Attendance Tracking', desc: 'Real-time check-in/out with geo-fencing.' },
      { icon: Calendar, title: 'Holiday Calendar', desc: 'Company-wide holiday scheduling.' },
      { icon: FileText, title: 'Leave Management', desc: 'Automated workflows with approval chains.' },
      { icon: Bell, title: 'Notifications', desc: 'Alerts for late arrivals, absences, and holidays.' },
    ]
  },
  {
    title: 'Payroll & Finance', color: '#f59e0b',
    items: [
      { icon: Globe, title: 'Multi-Currency Payroll', desc: 'Global payroll with tax compliance.' },
      { icon: BarChart3, title: 'Reports & Analytics', desc: 'Comprehensive reports and cost analysis.' },
    ]
  },
  {
    title: 'Management', color: '#ef4444',
    items: [
      { icon: Shield, title: 'Role-Based Access', desc: 'Granular permissions for all roles.' },
      { icon: Briefcase, title: 'Job Postings', desc: 'Create listings with application tracking.' },
      { icon: MessageSquare, title: 'Support Tickets', desc: 'Built-in ticketing system.' },
      { icon: FileText, title: 'Audit Logs', desc: 'Complete activity tracking for compliance.' },
    ]
  },
]

export function Features() {
  return (
    <div style={{ background: '#fff', color: '#111827', minHeight: '100vh', paddingTop: 68 }}>
      <section style={{ padding: '64px 24px', textAlign: 'center', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
        <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 12, color: '#111827' }}>
          Powerful Features for <span style={{ color: '#f97316' }}>Modern HR</span>
        </h1>
        <p style={{ fontSize: 16, color: '#6b7280', maxWidth: 500, margin: '0 auto 28px' }}>
          Everything to manage your workforce efficiently.
        </p>
        <Link to="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600, color: '#fff', textDecoration: 'none', background: '#f97316' }}>
          Start Free Trial <ArrowRight size={16} />
        </Link>
      </section>

      {categories.map(cat => (
        <section key={cat.title} style={{ padding: '64px 24px', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 32, color: '#111827' }}>
              <span style={{ color: cat.color }}>{cat.title}</span>
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
              {cat.items.map(item => {
                const Icon = item.icon
                return (
                  <div key={item.title} style={{ display: 'flex', gap: 16, padding: 24, borderRadius: 12, background: '#fff', border: '1px solid #f3f4f6' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 10, background: `${cat.color}15`, color: cat.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={24} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{item.title}</h3>
                      <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6 }}>{item.desc}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      ))}

      <section style={{ padding: '48px 24px', textAlign: 'center' }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>And More</h2>
        <div style={{ maxWidth: 600, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {['Shift scheduling', 'Overtime', 'Expense management', 'Compliance', 'Data export', 'Mobile ready'].map(f => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151' }}>
              <CheckCircle size={16} color="#f97316" /> {f}
            </div>
          ))}
        </div>
      </section>

      <section style={{ padding: '48px 24px', textAlign: 'center', background: '#fff7ed', borderTop: '1px solid #f3f4f6' }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Ready to See It?</h2>
        <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 24, maxWidth: 450, margin: '0 auto 24px' }}>
          HR MAX — all-in-one HR management for your organization.
        </p>
        <Link to="/register" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600, color: '#fff', textDecoration: 'none', background: '#f97316' }}>
          Get Started <ArrowRight size={16} />
        </Link>
      </section>
    </div>
  )
}
