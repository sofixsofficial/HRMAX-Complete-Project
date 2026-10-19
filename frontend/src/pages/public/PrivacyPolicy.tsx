import { Shield, Eye, Database, Lock, Bell, Mail, Globe, UserCheck } from 'lucide-react'

const sections = [
  {
    icon: Database,
    title: 'Information We Collect',
    content: [
      'Employee profile data (name, email, phone, department, designation, employee ID)',
      'Attendance data (check-in/out times, GPS coordinates, device information, network details)',
      'Leave requests and approval history',
      'Payroll and salary information (salary structure, deductions, tax details)',
      'Task and support ticket data',
      'Device information (OS version, device model, push notification tokens)',
      'Documents uploaded by employees (Aadhar, PAN, joining letter, offer letter)',
    ],
  },
  {
    icon: Eye,
    title: 'How We Use Your Information',
    content: [
      'Process and manage employee attendance, including GPS-based verification',
      'Calculate and generate payroll, salary slips, and tax computations',
      'Manage leave requests through the multi-tier approval workflow',
      'Send push notifications for approvals, task assignments, and announcements',
      'Generate HR reports and analytics for authorized administrators',
      'Verify employee identity for attendance and security purposes',
      'Communicate important company announcements and updates',
    ],
  },
  {
    icon: UserCheck,
    title: 'Who Has Access',
    content: [
      'Master Admin: Full access to all company data across the platform',
      'Company Admin: Access to their assigned company\'s employee data',
      'Executive: Access to assigned companies and departments',
      'Team Leader: Access to their assigned team members',
      'Reporting Manager: Access to their direct reports',
      'Employee: Access to their own profile, attendance, leaves, and salary slips only',
      'All access is logged and audited through the built-in audit trail system',
    ],
  },
  {
    icon: Lock,
    title: 'Data Security',
    content: [
      'All data is encrypted in transit using TLS 1.3',
      'Data at rest is encrypted using Google Cloud\'s AES-256 encryption',
      'Firebase Authentication with secure session management',
      'Role-based access control (RBAC) ensures least-privilege access',
      'All write operations are performed through server-side Cloud Functions',
      'Regular security audits and vulnerability assessments',
      'SOC 2 compliant infrastructure via Google Cloud Platform',
    ],
  },
  {
    icon: Globe,
    title: 'Data Storage & Location',
    content: [
      'All data is stored on Google Cloud Platform servers in the United States',
      'Firebase Firestore provides automatic replication and backup',
      'Cloud Functions run in us-central1 region',
      'We do not sell, rent, or share personal data with third parties for advertising',
      'Data is retained for the duration of your organization\'s account',
    ],
  },
  {
    icon: Bell,
    title: 'Push Notifications',
    content: [
      'We send push notifications for leave approvals, task assignments, and attendance reminders',
      'Notification tokens are stored securely and only used for HR-related communications',
      'You can disable push notifications in your device settings at any time',
      'We never send marketing or promotional push notifications',
    ],
  },
  {
    icon: Mail,
    title: 'Email Communications',
    content: [
      'Transaction emails for salary slips and password resets',
      'System notifications for approval workflows',
      'Company announcements distributed by administrators',
      'We do not send unsolicited marketing emails',
    ],
  },
  {
    icon: Shield,
    title: 'Your Rights',
    content: [
      'Access: Request a copy of all personal data we hold about you',
      'Correction: Request correction of inaccurate personal data',
      'Deletion: Request deletion of your personal data (subject to legal retention requirements)',
      'Portability: Request your data in a commonly used format',
      'Restriction: Request restriction of processing of your personal data',
      'Contact our Data Protection Officer at info@hrmax.in to exercise any of these rights',
    ],
  },
]

export function PrivacyPolicy() {
  return (
    <div style={{ background: '#fff', color: '#111827', minHeight: '100vh', paddingTop: 68 }}>
      {/* Header */}
      <section style={{ padding: '64px 24px', textAlign: 'center', background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#f0fdf4', color: '#16a34a', padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, marginBottom: 20 }}>
            <Shield size={16} /> Privacy & Data Protection
          </div>
          <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 16, color: '#111827' }}>
            Privacy <span style={{ color: '#f97316' }}>Policy</span>
          </h1>
          <p style={{ fontSize: 14, color: '#9ca3af', marginBottom: 8 }}>
            Last updated: September 20, 2026
          </p>
          <p style={{ fontSize: 16, color: '#6b7280', lineHeight: 1.7 }}>
            HR MAX ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Human Resource Management System, including the web application and mobile application (collectively, the "Service").
          </p>
        </div>
      </section>

      {/* Quick Summary */}
      <section style={{ padding: '32px 24px', maxWidth: 800, margin: '0 auto' }}>
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#92400e', marginBottom: 8 }}>📋 Quick Summary</h3>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#78350f', fontSize: 14, lineHeight: 1.8 }}>
            <li>We collect employee data necessary for HR management (attendance, leave, payroll)</li>
            <li>GPS location is collected for attendance verification only</li>
            <li>Your data is encrypted and stored securely on Google Cloud</li>
            <li>We never sell or share your personal data with third parties</li>
            <li>You have full rights to access, correct, or delete your data</li>
          </ul>
        </div>
      </section>

      {/* Sections */}
      <section style={{ padding: '32px 24px', maxWidth: 800, margin: '0 auto' }}>
        {sections.map((section, idx) => {
          const Icon = section.icon
          return (
            <div key={idx} style={{ marginBottom: 40 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#f97316', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={20} color="#fff" />
                </div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 }}>{section.title}</h2>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#4b5563', fontSize: 15, lineHeight: 2 }}>
                {section.content.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )
        })}
      </section>

      {/* Children's Privacy */}
      <section style={{ padding: '32px 24px', maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Children's Privacy</h2>
        <p style={{ color: '#4b5563', fontSize: 15, lineHeight: 1.8 }}>
          Our Service is designed for use by organizations and their employees. We do not knowingly collect personal information from children under 13. If you are a parent or guardian and believe your child has provided us with personal information, please contact us at info@hrmax.in.
        </p>
      </section>

      {/* Changes to Policy */}
      <section style={{ padding: '32px 24px', maxWidth: 800, margin: '0 auto' }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Changes to This Policy</h2>
        <p style={{ color: '#4b5563', fontSize: 15, lineHeight: 1.8 }}>
          We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date. You are advised to review this Privacy Policy periodically for any changes.
        </p>
      </section>

      {/* Contact */}
      <section style={{ padding: '48px 24px', background: '#111827', color: '#fff' }}>
        <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Questions About Privacy?</h2>
          <p style={{ color: '#9ca3af', fontSize: 15, marginBottom: 24 }}>
            Contact our Data Protection Officer for any privacy-related inquiries.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
            <a href="mailto:info@hrmax.in" style={{ color: '#f97316', fontSize: 15, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Mail size={16} /> info@hrmax.in
            </a>
            <a href="tel:9601582622" style={{ color: '#f97316', fontSize: 15, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Shield size={16} /> 9601582622
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
