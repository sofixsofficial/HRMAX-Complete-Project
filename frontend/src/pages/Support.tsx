import { useState, useEffect, useRef, useCallback } from 'react'
import { Header } from '../components/Header'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { sendSupportTicket } from '../services/emailService'
import { createTicket, getTicketsByCompany, getTicketStats } from '../services/ticketService'
import { logAudit } from '../services/auditLogService'
import { useNavigate } from 'react-router-dom'
import {
  HelpCircle, MessageSquare, ChevronRight, Loader2, CheckCircle,
  AlertCircle, Send, FileText, ExternalLink, ChevronDown, Search,
  BookOpen, Mail, Clock, ArrowLeft, Building2, BarChart3, Upload,
  File, X, Paperclip, LifeBuoy, Zap, Inbox, Ticket, Lightbulb,
  ChevronUp
} from 'lucide-react'
import type { SupportTicket } from '../types/user'
import './Support.css'

const CATEGORIES = ['IT Support', 'HR', 'Finance', 'General', 'Technical', 'Access Request']
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']

const FAQ_ITEMS = [
  { q: 'How do I reset my password?', a: 'Go to Settings > Security and enter a new password. If you\'re locked out, use the "Forgot Password" link on the login page.' },
  { q: 'How do I submit leave?', a: 'Navigate to Leaves from the sidebar, click "Request Leave", select your dates and type, then submit for approval.' },
  { q: 'How do I view my payslips?', a: 'Go to Payroll from the Operations section in the sidebar to view and download your salary slips.' },
  { q: 'How do I update my profile?', a: 'Click on Settings in the sidebar, then select the Profile Settings tab to update your details.' },
  { q: 'How do I contact IT support?', a: 'Use this form below to submit a support ticket. For urgent issues, contact your team leader directly.' },
]

const PRIORITY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Low: { bg: '#f3f4f6', text: '#6b7280', dot: '#9ca3af' },
  Medium: { bg: '#fff7ed', text: '#c2410c', dot: '#f97316' },
  High: { bg: '#fef2f2', text: '#dc2626', dot: '#ef4444' },
  Urgent: { bg: '#fef2f2', text: '#991b1b', dot: '#dc2626' },
}

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Open: { bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' },
  'In Progress': { bg: '#fefce8', text: '#a16207', dot: '#eab308' },
  Resolved: { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
  Closed: { bg: '#f3f4f6', text: '#6b7280', dot: '#9ca3af' },
}

function formatTicketDate(date: Date | string | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function Support() {
  const { user } = useAuth()
  const { effectiveCompanyId, availableCompanies, selectedCompanyName, isLoading: companyLoading } = usePermissionScope('support')
  const navigate = useNavigate()
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [priority, setPriority] = useState('Medium')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [ticketId, setTicketId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  const [companyTickets, setCompanyTickets] = useState<SupportTicket[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(false)
  const [companyStats, setCompanyStats] = useState({ total: 0, open: 0, resolved: 0 })

  // File upload state
  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeCompanyId = effectiveCompanyId || user?.companyId || ''
  const activeCompanyName = selectedCompanyName || availableCompanies.find(c => c.id === activeCompanyId)?.name || ''

  useEffect(() => {
    if (!activeCompanyId || companyLoading) return
    setTicketsLoading(true)
    Promise.all([
      getTicketsByCompany(activeCompanyId),
      getTicketStats(activeCompanyId),
    ]).then(([tickets, stats]) => {
      setCompanyTickets(tickets)
      setCompanyStats({ total: stats.total, open: stats.open, resolved: stats.resolved })
    }).catch(() => {}).finally(() => setTicketsLoading(false))
  }, [activeCompanyId, companyLoading])

  const filteredFaq = FAQ_ITEMS.filter(item =>
    item.q.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    setFiles(prev => [...prev, ...dropped].slice(0, 5))
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)].slice(0, 5))
    }
  }

  const removeFile = (idx: number) => {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !description.trim()) {
      setError('Please fill in all required fields.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const execId = (user as any)?.reportingExecutiveId || (user as any)?.linkedExecutiveIds?.[0] || ''
      const execName = (user as any)?.reportingExecutiveName || ''
      const tlId = user?.role === 'team-leader' ? user.id : ''

      const created = await createTicket({
        title: subject.trim(),
        description: description.trim(),
        category,
        priority: priority as 'Low' | 'Medium' | 'High' | 'Urgent',
        status: 'Open',
        createdBy: user?.name || 'Unknown',
        createdById: user?.id || '',
        companyId: activeCompanyId,
        companyName: activeCompanyName,
        executiveId: execId || undefined,
        executiveName: execName || undefined,
        tlId: tlId || undefined,
        tlName: tlId ? user?.name : undefined,
      })
      const newTicketId = created.id
      setTicketId(newTicketId)

      logAudit({
        userId: user?.id || '', userName: user?.name || '', userRole: user?.role || 'employee',
        action: 'Created support ticket', actionType: 'create', module: 'Support',
        targetEntity: subject.trim(), status: 'success',
        details: `Ticket ${newTicketId} - ${category} - ${priority} - Company: ${activeCompanyName}`,
      })

      try {
        await sendSupportTicket({
          subject: subject.trim(),
          description: description.trim(),
          category,
          priority,
          userName: user?.name,
          userEmail: user?.email,
          ticketId: newTicketId,
        })
      } catch (emailErr) {
        console.warn('Email delivery failed, ticket saved to DB:', emailErr)
      }

      setSubmitted(true)
      setSubject('')
      setDescription('')
      setCategory(CATEGORIES[0])
      setPriority('Medium')
      setFiles([])
    } catch (err: any) {
      console.error('Error submitting ticket:', err)
      setError(err?.message || 'Failed to submit your request. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="page-container">
        <Header title="Support" breadcrumbs={['Dashboard', 'Support']} />
        <div className="page-content">
          <div className="sp-success-container">
            <div className="sp-success-glow" />
            <div className="sp-success-icon">
              <CheckCircle size={48} />
            </div>
            <h2>Ticket Submitted!</h2>
            <p>Your support request has been received.</p>
            {ticketId && (
              <div className="sp-ticket-id">
                <span>Ticket ID: </span>
                <code>{ticketId}</code>
              </div>
            )}
            <p className="sp-success-note">
              A confirmation has been sent to our support team. We'll get back to you shortly.
            </p>
            <div className="sp-success-actions">
              <button className="btn-primary" onClick={() => { setSubmitted(false); setTicketId(null) }}>
                <Send size={16} /> Submit Another
              </button>
              <button className="btn-secondary" onClick={() => navigate('/')}>
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title="Support" breadcrumbs={['Dashboard', 'Support']} />

      <div className="page-content">
        {error && (
          <div className="sp-error">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button onClick={() => setError(null)}><AlertCircle size={14} /></button>
          </div>
        )}

        <div className="sp-hero">
          <div className="sp-hero-content">
            <h1>How can we help you?</h1>
            <p>Submit a ticket and our team will get back to you within 24 hours.</p>
          </div>
        </div>

        <div className="sp-layout">
          {/* Left: Ticket Form */}
          <div className="sp-form-section">
            <div className="sp-form-glass">
              <div className="sp-form-header">
                <div className="sp-form-icon-row">
                  <MessageSquare size={18} />
                  <h3>Submit a Request</h3>
                </div>
                <p>Fill in the details below and our support team will reach out.</p>
              </div>

              <form onSubmit={handleSubmit} className="sp-form">
                {activeCompanyName && (
                  <div className="sp-form-group">
                    <label>Company</label>
                    <div className="sp-company-badge">
                      <Building2 size={14} />
                      <span>{activeCompanyName}</span>
                    </div>
                    <input type="hidden" name="companyId" value={activeCompanyId} />
                  </div>
                )}

                <div className="sp-form-group">
                  <label>Subject *</label>
                  <div className="sp-input-wrap">
                    <input
                      type="text"
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      placeholder="Brief summary of your issue"
                      required
                      maxLength={200}
                    />
                  </div>
                </div>

                <div className="sp-form-row">
                  <div className="sp-form-group">
                    <label>Category *</label>
                    <div className="sp-input-wrap">
                      <select value={category} onChange={e => setCategory(e.target.value)} required>
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="sp-form-group">
                    <label>Priority</label>
                    <div className="sp-priority-tags">
                      {PRIORITIES.map(p => {
                        const colors = PRIORITY_COLORS[p]
                        return (
                          <button
                            key={p}
                            type="button"
                            className={`sp-priority-tag ${priority === p ? 'active' : ''}`}
                            style={{
                              '--tag-bg': colors.bg,
                              '--tag-text': colors.text,
                              '--tag-dot': colors.dot,
                            } as React.CSSProperties}
                            onClick={() => setPriority(p)}
                          >
                            <span className="sp-priority-dot" />
                            {p}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div className="sp-form-group">
                  <label>Description *</label>
                  <div className="sp-input-wrap">
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      placeholder="Describe your issue in detail. Include any steps to reproduce, error messages, or screenshots if applicable."
                      rows={6}
                      required
                    />
                  </div>
                </div>

                {/* Drag & Drop File Upload */}
                <div className="sp-form-group">
                  <label>Attachments</label>
                  <div
                    className={`sp-dropzone ${dragOver ? 'drag-over' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      hidden
                      onChange={handleFileSelect}
                      accept="image/*,.pdf,.doc,.docx,.txt,.log"
                    />
                    <Upload size={24} className="sp-dropzone-icon" />
                    <p className="sp-dropzone-text">
                      {dragOver ? 'Drop files here' : 'Drag & drop files or click to browse'}
                    </p>
                    <p className="sp-dropzone-hint">Supports images, PDF, DOC — up to 5 files</p>
                  </div>
                  {files.length > 0 && (
                    <div className="sp-file-list">
                      {files.map((f, idx) => (
                        <div key={idx} className="sp-file-item">
                          <File size={14} />
                          <span className="sp-file-name">{f.name}</span>
                          <span className="sp-file-size">{(f.size / 1024).toFixed(0)} KB</span>
                          <button type="button" className="sp-file-remove" onClick={() => removeFile(idx)}>
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="sp-form-meta">
                  <Mail size={14} />
                  <span>Your request will be sent to <strong>support@hrmax.com</strong></span>
                </div>

                <button
                  type="submit"
                  className="btn-primary sp-submit-btn"
                  disabled={submitting}
                >
                  {submitting ? (
                    <><Loader2 size={16} className="animate-spin" /> Submitting...</>
                  ) : (
                    <><Send size={16} /> Submit Ticket</>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Right: Help Center Panel */}
          <div className="sp-knowledge-section">
            {/* Ticket Status Cards */}
            <div className="sp-kb-card">
              <div className="sp-kb-header">
                <BarChart3 size={18} />
                <h3>Ticket Overview</h3>
              </div>
              {activeCompanyName ? (
                <div className="sp-status-grid">
                  <div className="sp-status-card sp-status-card-total">
                    <span className="sp-status-number">{companyStats.total}</span>
                    <span className="sp-status-label">Total</span>
                  </div>
                  <div className="sp-status-card sp-status-card-open">
                    <span className="sp-status-number">{companyStats.open}</span>
                    <span className="sp-status-label">Open</span>
                  </div>
                  <div className="sp-status-card sp-status-card-resolved">
                    <span className="sp-status-number">{companyStats.resolved}</span>
                    <span className="sp-status-label">Resolved</span>
                  </div>
                </div>
              ) : (
                <p className="sp-kb-empty">Select a company to view support overview.</p>
              )}
            </div>

            {/* My Support Tickets */}
            <div className="sp-kb-card">
              <div className="sp-kb-header">
                <Inbox size={18} />
                <h3>Recent Tickets</h3>
                {ticketsLoading && <Loader2 size={14} className="animate-spin" />}
              </div>
              <div className="sp-tickets-mini">
                {ticketsLoading ? (
                  <p className="sp-kb-empty">Loading...</p>
                ) : companyTickets.length === 0 ? (
                  <div className="sp-empty-state">
                    <div className="sp-empty-illustration">
                      <Ticket size={40} />
                    </div>
                    <p className="sp-empty-title">No tickets yet</p>
                    <p className="sp-empty-desc">
                      Create your first support ticket using the form.
                    </p>
                  </div>
                ) : (
                  companyTickets.slice(0, 5).map(t => {
                    const sc = STATUS_COLORS[t.status] || STATUS_COLORS.Open
                    return (
                      <div key={t.id} className="sp-mini-ticket">
                        <span className="sp-mini-status-dot" style={{ background: sc.dot }} />
                        <div className="sp-mini-info">
                          <span className="sp-mini-subject">{t.title}</span>
                          <span className="sp-mini-meta">
                            <span className="sp-mini-badge" style={{ background: sc.bg, color: sc.text }}>
                              {t.status}
                            </span>
                            <span className="sp-mini-time">{formatTicketDate(t.createdAt)}</span>
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
                {companyTickets.length > 0 && (
                  <a href="/support-tickets" className="sp-view-all">
                    <MessageSquare size={14} />
                    Manage All Tickets →
                  </a>
                )}
              </div>
            </div>

            {/* Knowledge Base */}
            <div className="sp-kb-card">
              <div className="sp-kb-header">
                <BookOpen size={18} />
                <h3>Knowledge Base</h3>
              </div>

              <div className="sp-search-box">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search FAQs..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="sp-faq-list">
                {filteredFaq.length === 0 ? (
                  <p className="sp-faq-empty">No matching questions found.</p>
                ) : (
                  filteredFaq.map((item, idx) => (
                    <div key={idx} className="sp-faq-item">
                      <button
                        className={`sp-faq-question ${expandedFaq === idx ? 'expanded' : ''}`}
                        onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                      >
                        <HelpCircle size={16} />
                        <span>{item.q}</span>
                        {expandedFaq === idx ? (
                          <ChevronUp size={16} className="sp-faq-arrow open" />
                        ) : (
                          <ChevronDown size={16} className="sp-faq-arrow" />
                        )}
                      </button>
                      <div className={`sp-faq-answer ${expandedFaq === idx ? 'open' : ''}`}>
                        <p>{item.a}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="sp-kb-card">
              <div className="sp-kb-header">
                <Zap size={18} />
                <h3>Quick Actions</h3>
              </div>
              <a href="/reports" className="sp-resource-link">
                <FileText size={14} />
                <span>Reports & Analytics</span>
                <ExternalLink size={12} />
              </a>
              <a href="/settings" className="sp-resource-link">
                <Clock size={14} />
                <span>Account Settings</span>
                <ExternalLink size={12} />
              </a>
              <a href="/support-tickets" className="sp-resource-link">
                <LifeBuoy size={14} />
                <span>All Support Tickets</span>
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
