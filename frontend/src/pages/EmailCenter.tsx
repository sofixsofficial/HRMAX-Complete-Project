import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Mail, Search, Plus, Send, Inbox, FileText,
  ChevronLeft, ChevronRight, Eye, Trash2, Download, Filter,
  Users, Building2, User, X, Star, Clock, AlertCircle,
  CheckCircle, Archive, Reply, Forward, Bold, Italic,
  Underline, List, Link as LinkIcon,
  Loader2, RefreshCw
} from 'lucide-react'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { Toast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useTLFilter } from '../context/TLFilterContext'
import { getEmployeesByCompany, getEmployeesByCompanies } from '../services/employeeService'
import { getSalarySlipsByCompany, dispatchPayslips, retryFailedPayslips } from '../services/salaryService'
import * as emailService from '../services/emailService'
import type { Email, EmailTemplate, EmailTab, MailType, DeliveryStatus } from '../types/email'
import type { SalarySlip } from '../types/user'
import { TEMPLATES, RECIPIENT_GROUPS } from '../types/email'
import './EmailCenter.css'

interface ComposeState {
  toEmail: string
  toName: string
  cc: string
  bcc: string
  subject: string
  body: string
  recipientGroup: string
  scheduledFor: string
  replyToId?: string
  forwardOfId?: string
}

const INITIAL_COMPOSE: ComposeState = {
  toEmail: '',
  toName: '',
  cc: '',
  bcc: '',
  subject: '',
  body: '',
  recipientGroup: 'Individual Employee',
  scheduledFor: '',
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function EmailCenter() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { effectiveCompanyId, availableCompanies } = usePermissionScope('emails')
  const [activeTab, setActiveTab] = useState<EmailTab>('inbox')
  const [emails, setEmails] = useState<Email[]>([])
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null)
  const [isViewOpen, setIsViewOpen] = useState(false)
  const [isComposeOpen, setIsComposeOpen] = useState(false)
  const [composeData, setComposeData] = useState<ComposeState>(INITIAL_COMPOSE)
  const [searchTerm, setSearchTerm] = useState('')
  const [mailTypeFilter, setMailTypeFilter] = useState<MailType>('All')
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({})
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [isSending, setIsSending] = useState(false)
  const [selectedEmails, setSelectedEmails] = useState<string[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [showCC, setShowCC] = useState(false)
  const [showBCC, setShowBCC] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [loading, setLoading] = useState(true)
  const editorRef = useRef<HTMLDivElement>(null)
  const [resolvedRecipients, setResolvedRecipients] = useState<{ name: string; email: string }[]>([])
  const [showRecipientPicker, setShowRecipientPicker] = useState(false)

  // Pre-applied payroll filters (company + month + year) when navigated here
  // right after salary-slip generation.
  const [payrollFilter, setPayrollFilter] = useState<{ companyId: string; monthIndex: number; year: number } | null>(null)
  const payrollOpenedRef = useRef(false)

  // Exact subset of employees included in the payroll run for this company/period.
  const [payrollSlips, setPayrollSlips] = useState<SalarySlip[]>([])
  const [payrollSlipSel, setPayrollSlipSel] = useState<Set<string>>(new Set())
  const [payrollSlipsLoading, setPayrollSlipsLoading] = useState(false)
  const [payrollSending, setPayrollSending] = useState(false)

  const slipEmailStatus = (slip: SalarySlip): 'Sent' | 'Failed' | 'Retrying' | 'Not sent' => {
    if (slip.emailSentAt && slip.emailStatus === 'sent') return 'Sent'
    if (slip.emailStatus === 'failed' || slip.payslipEmailStatus === 'failed') return 'Failed'
    if (slip.emailStatus === 'retrying') return 'Retrying'
    return 'Not sent'
  }

  const loadPayrollSlips = async (cid: string, monthIndex: number, year: number) => {
    setPayrollSlipsLoading(true)
    try {
      const all = await getSalarySlipsByCompany(cid)
      const monthName = MONTHS[monthIndex] || ''
      const slips = all.filter(s => s.month === monthName && s.year === year)
      setPayrollSlips(slips)
      setPayrollSlipSel(new Set(slips.map(s => s.id)))
    } catch {
      setPayrollSlips([])
      setPayrollSlipSel(new Set())
    } finally {
      setPayrollSlipsLoading(false)
    }
  }

  const refreshPayrollSlips = async () => {
    if (!payrollFilter) return
    await loadPayrollSlips(payrollFilter.companyId, payrollFilter.monthIndex, payrollFilter.year)
  }

  const sendPayrollEmails = async () => {
    if (!payrollFilter) return
    const selected = payrollSlips.filter(s => payrollSlipSel.has(s.id))
    const userIds = selected.map(s => s.userId).filter(Boolean)
    if (!userIds.length) {
      setToast({ message: 'Select at least one employee to send payroll emails', type: 'error' })
      return
    }
    setPayrollSending(true)
    try {
      const res = await dispatchPayslips({
        companyId: payrollFilter.companyId,
        monthIndex: payrollFilter.monthIndex,
        year: payrollFilter.year,
        payStatus: 'all',
        employeeIds: userIds,
        bcc: user?.email ? [user.email] : [],
      })
      if (res.success) {
        setToast({ message: `${res.message || `Sent ${res.dispatched} salary slips.`}`, type: (res.failed ?? 0) > 0 ? 'error' : 'success' })
      } else {
        setToast({ message: res.error || 'Failed to send payroll emails', type: 'error' })
      }
      await refreshPayrollSlips()
      await loadEmails()
    } catch (err: any) {
      setToast({ message: err?.message || 'Failed to send payroll emails', type: 'error' })
    } finally {
      setPayrollSending(false)
    }
  }

  const retrySingleSlipEmail = async (slip: SalarySlip) => {
    if (!payrollFilter) return
    setToast({ message: `Retrying email for ${slip.employeeName}...`, type: 'success' })
    try {
      const res = await retryFailedPayslips({ companyId: payrollFilter.companyId, slipIds: [slip.id] })
      setToast({ message: res?.success ? `Sent ${res.dispatched}, ${res.failed} failed` : 'Retry failed', type: res?.failed ? 'error' : 'success' })
      await refreshPayrollSlips()
      await loadEmails()
    } catch {
      setToast({ message: 'Retry failed', type: 'error' })
    }
  }

  const payrollCompanyName = payrollFilter
    ? availableCompanies.find(c => c.id === payrollFilter.companyId)?.name || 'Selected company'
    : ''

  const startPayrollCompose = async (cid: string, monthIndex: number, year: number) => {
    resetCompose()
    const comp = availableCompanies.find(c => c.id === cid)
    const cn = comp?.name || 'the Company'
    const subject = `Salary Slip for ${MONTHS[monthIndex] || ''} ${year} - ${cn}`
    const body = `<p>Dear {Employee Name},</p><p>Here is your salary slip for <b>${MONTHS[monthIndex] || ''} ${year}</b>. Securely attached to this email is your payslip PDF.</p><p>Kindly go through the breakdown — Basic, Allowances, Deductions and Net Pay — and reach out to your Company Admin in case of any discrepancy.</p><p>Thank you,<br/><b>${cn} — HR Team</b></p>`
    setComposeData(prev => ({
      ...prev,
      subject,
      body,
      bcc: user?.email || '',
      recipientGroup: 'Individual Employee',
    }))
    setIsComposeOpen(true)
    setComposeCompanyId(cid)
    if (editorRef.current) editorRef.current.innerHTML = body
    if (isTLOrExec) {
      setLoadingEmployees(true)
      try {
        const emps = await getEmployeesByCompany(cid)
        const list = emps.filter(e => e.status === 'Active').map(e => ({ name: e.name || e.email, email: e.email, id: e.id }))
        setEmployeeList(list)
        // Kept un-checked: individual payroll emails are sent via the isolated
        // per-employee batch below — never one mass email mixing recipients.
        setSelectedEmployeeIds(new Set())
      } catch {
        setEmployeeList([])
      } finally {
        setLoadingEmployees(false)
      }
    }
  }

  const isTLOrExec = user?.role === 'team-leader' || user?.role === 'executive'
  const [composeCompanyId, setComposeCompanyId] = useState<string>('')
  const [employeeList, setEmployeeList] = useState<{ name: string; email: string; id: string }[]>([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set())
  const [loadingEmployees, setLoadingEmployees] = useState(false)
  const [listCompanyId, setListCompanyId] = useState<string>('')
  const [selectedExecId, setSelectedExecId] = useState<string>('')

  const tlCtx = useTLFilter()
  const tlExecutives = tlCtx?.executives || []

  const composeCompanies = useMemo(() => {
    if (!isTLOrExec) return availableCompanies
    if (!selectedExecId) return availableCompanies
    const exec = tlExecutives.find(e => e.id === selectedExecId)
    if (!exec) return availableCompanies
    return availableCompanies.filter(c => exec.assignedCompanyIds.includes(c.id))
  }, [isTLOrExec, selectedExecId, tlExecutives, availableCompanies])

  const companyId = effectiveCompanyId || user?.companyId || ''
  const companyName = availableCompanies.find(c => c.id === companyId)?.name || ''

  // Firestore Timestamps can sneak into legacy docs — coerce anything to an ISO string
  const dateStr = (v: any): string => {
    if (typeof v === 'string') return v
    if (v && typeof v.toDate === 'function') return v.toDate().toISOString()
    if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString()
    return ''
  }

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['inbox', 'sent', 'drafts', 'scheduled', 'trash'].includes(tab)) {
      setActiveTab(tab as EmailTab)
    }
    loadEmails()
  }, [companyId, user?.role, listCompanyId])

  // Payroll filters: when navigated here right after salary-slip generation
  // with company + month + year query params, pre-apply filters and auto-open
  // the compose modal with employees of that company already loaded & selected.
  useEffect(() => {
    const company = searchParams.get('company')
    const month = searchParams.get('month')
    const year = searchParams.get('year')
    if (company && month && year) {
      const mi = parseInt(month, 10)
      const yr = parseInt(year, 10)
      if (!Number.isNaN(mi) && !Number.isNaN(yr)) {
        setPayrollFilter({ companyId: company, monthIndex: mi, year: yr })
        if (isTLOrExec) setListCompanyId(company)
        loadPayrollSlips(company, mi, yr)
        if (!payrollOpenedRef.current) {
          payrollOpenedRef.current = true
          startPayrollCompose(company, mi, yr)
        }
        return
      }
    }
    if (payrollOpenedRef.current) {
      payrollOpenedRef.current = false
      setPayrollFilter(null)
    }
  }, [searchParams])

  const loadEmails = async () => {
    setLoading(true)
    try {
      const filterCid = isTLOrExec && listCompanyId ? listCompanyId : companyId
      const data = await emailService.fetchEmails(filterCid, user?.role)
      setEmails(data)
    } catch (err) {
      console.error('Error fetching emails:', err)
      setToast({ message: 'Failed to load emails', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const stats = {
    total: emails.length,
    sent: emails.filter(e => ['Sent', 'Delivered', 'Opened', 'Clicked'].includes(e.status)).length,
    drafts: emails.filter(e => e.status === 'Draft').length,
    scheduled: emails.filter(e => e.status === 'Scheduled').length,
    failed: emails.filter(e => e.status === 'Failed').length,
    unread: emails.filter(e => !e.read && !['Draft', 'Scheduled'].includes(e.status)).length,
  }

  const filteredEmails = emails.filter(e => {
    if (payrollFilter) {
      if (e.companyId !== payrollFilter.companyId) return false
      const pMonth = Number((e as any).payrollMonth)
      const pYear = Number((e as any).payrollYear)
      if (!Number.isNaN(pMonth) && !Number.isNaN(pYear)) {
        if (pMonth !== payrollFilter.monthIndex || pYear !== payrollFilter.year) return false
      } else {
        const subj = `${e.subject || ''} ${e.body || ''}`
        if (!subj.includes(`${MONTHS[payrollFilter.monthIndex]} ${payrollFilter.year}`)) return false
      }
    }
    if (activeTab === 'inbox') {
      if (['Draft', 'Scheduled'].includes(e.status)) return false
      if (e.toEmail !== user?.email && e.status === 'Sent') return true
      if (e.toEmail === user?.email) return true
      if (e.fromEmail !== user?.email && e.toEmail !== user?.email) return false
    }
    if (activeTab === 'sent' && !['Sent', 'Delivered', 'Opened', 'Clicked', 'Failed'].includes(e.status)) return false
    if (activeTab === 'drafts' && e.status !== 'Draft') return false
    if (activeTab === 'scheduled' && e.status !== 'Scheduled') return false
    if (activeTab === 'trash' && e.status !== 'Deleted') return false
    if (mailTypeFilter !== 'All' && e.type !== mailTypeFilter) return false
    if (searchTerm) {
      const s = searchTerm.toLowerCase()
      if (!e.subject?.toLowerCase().includes(s) && !e.from?.toLowerCase().includes(s) && !e.to?.toLowerCase().includes(s) && !e.body?.toLowerCase().includes(s)) return false
    }
    return true
  }).sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1
    return new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
  })

  const totalPages = Math.ceil(filteredEmails.length / pageSize)
  const paginated = filteredEmails.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const resetCompose = useCallback(() => {
    setComposeData(INITIAL_COMPOSE)
    setSelectedTemplate('')
    setTemplateVars({})
    setShowCC(false)
    setShowBCC(false)
    setShowTemplates(false)
    setResolvedRecipients([])
    setComposeCompanyId('')
    setEmployeeList([])
    setSelectedEmployeeIds(new Set())
    setSelectedExecId('')
    if (editorRef.current) editorRef.current.innerHTML = ''
  }, [])

  const openCompose = (initial?: Partial<ComposeState>) => {
    resetCompose()
    if (initial) setComposeData(prev => ({ ...prev, ...initial }))
    setIsComposeOpen(true)
  }

  const handleCompanyFilterChange = async (cid: string) => {
    setComposeCompanyId(cid)
    setSelectedEmployeeIds(new Set())
    setEmployeeList([])
    setComposeData(prev => ({ ...prev, toEmail: '', toName: '' }))
    if (!cid) return
    setLoadingEmployees(true)
    try {
      let employees: { name: string; email: string; id: string }[] = []
      if (cid === 'all') {
        const companyIds = composeCompanies.map(c => c.id)
        const allEmps = await getEmployeesByCompanies(companyIds)
        employees = allEmps.filter(e => e.status === 'Active').map(e => ({
          name: e.name || e.email, email: e.email, id: e.id,
        }))
      } else {
        const emps = await getEmployeesByCompany(cid)
        employees = emps.filter(e => e.status === 'Active').map(e => ({
          name: e.name || e.email, email: e.email, id: e.id,
        }))
      }
      setEmployeeList(employees)
    } catch {
      setEmployeeList([])
    } finally {
      setLoadingEmployees(false)
    }
  }

  const handleExecFilterChange = (execId: string) => {
    setSelectedExecId(execId)
    setComposeCompanyId('')
    setEmployeeList([])
    setSelectedEmployeeIds(new Set())
    setComposeData(prev => ({ ...prev, toEmail: '', toName: '' }))
  }

  const handleSelectAllEmployees = () => {
    if (selectedEmployeeIds.size === employeeList.length && employeeList.length > 0) {
      setSelectedEmployeeIds(new Set())
      setComposeData(prev => ({ ...prev, toEmail: '', toName: '' }))
    } else {
      const allIds = new Set(employeeList.map(e => e.id))
      setSelectedEmployeeIds(allIds)
      setComposeData(prev => ({
        ...prev,
        toEmail: employeeList.map(e => e.email).join(', '),
        toName: employeeList.map(e => e.name).join(', '),
      }))
    }
  }

  const handleToggleEmployee = (emp: { name: string; email: string; id: string }) => {
    const next = new Set(selectedEmployeeIds)
    if (next.has(emp.id)) {
      next.delete(emp.id)
    } else {
      next.add(emp.id)
    }
    setSelectedEmployeeIds(next)
    const selected = employeeList.filter(e => next.has(e.id))
    setComposeData(prev => ({
      ...prev,
      toEmail: selected.map(e => e.email).join(', '),
      toName: selected.map(e => e.name).join(', '),
    }))
  }

  const handleReply = (email: Email) => {
    const prefix = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`
    openCompose({
      toEmail: email.fromEmail,
      toName: email.from,
      subject: prefix,
      replyToId: email.id,
      body: `<br/><br/><div style="padding:8px 12px;background:#f9fafb;border-left:3px solid #f97316;margin-top:8px"><p style="color:#6b7280;font-size:12px">On ${email.date}, ${email.from} wrote:</p>${email.body}</div>`,
    })
  }

  const handleForward = (email: Email) => {
    const prefix = email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`
    openCompose({
      subject: prefix,
      forwardOfId: email.id,
      body: `<br/><br/><div style="padding:8px 12px;background:#f9fafb;border-left:3px solid #3b82f6;margin-top:8px"><p style="color:#6b7280;font-size:12px">---------- Forwarded message ----------<br/>From: ${email.from}<br/>Date: ${email.date}<br/>Subject: ${email.subject}</p>${email.body}</div>`,
    })
  }

  const handleRecipientGroupChange = async (group: string) => {
    setComposeData(prev => ({ ...prev, recipientGroup: group }))
    const effectiveCid = composeCompanyId && composeCompanyId !== 'all' ? composeCompanyId : companyId
    if (group && group !== 'Individual Employee') {
      const recipients = composeCompanyId === 'all'
        ? await emailService.resolveRecipientGroup(group, undefined, composeCompanies.map(c => c.id))
        : await emailService.resolveRecipientGroup(group, effectiveCid)
      setResolvedRecipients(recipients)
      setComposeData(prev => ({
        ...prev,
        toEmail: recipients.map(r => r.email).join(', '),
        toName: recipients.map(r => r.name).join(', '),
      }))
    } else {
      setResolvedRecipients([])
    }
  }

  const handleTemplateSelect = (template: EmailTemplate) => {
    setSelectedTemplate(template.id)
    setShowTemplates(false)
    setComposeData(prev => ({
      ...prev,
      subject: template.subject,
      body: template.body.replace(/\n/g, '<br/>'),
    }))
    const vars: Record<string, string> = {}
    template.variables.forEach(v => { vars[v] = '' })
    setTemplateVars(vars)
    if (editorRef.current) editorRef.current.innerHTML = template.body.replace(/\n/g, '<br/>')
  }

  const applyTemplateVars = () => {
    const template = TEMPLATES.find(t => t.id === selectedTemplate)
    if (!template) return
    let body = template.body
    let subject = template.subject
    Object.entries(templateVars).forEach(([key, val]) => {
      body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), val || `{${key}}`)
      subject = subject.replace(new RegExp(`\\{${key}\\}`, 'g'), val || `{${key}}`)
    })
    setComposeData(prev => ({ ...prev, subject, body: body.replace(/\n/g, '<br/>') }))
    if (editorRef.current) editorRef.current.innerHTML = body.replace(/\n/g, '<br/>')
  }

  const handleSend = async () => {
    const toList = emailService.parseEmails(composeData.toEmail)
    if (toList.length === 0) {
      setToast({ message: 'Please enter at least one valid recipient email', type: 'error' })
      return
    }
    if (!composeData.subject.trim()) {
      setToast({ message: 'Please enter an email subject', type: 'error' })
      return
    }
    const body = editorRef.current?.innerHTML || composeData.body
    if (!body.replace(/<[^>]*>/g, '').trim()) {
      setToast({ message: 'Please enter an email body', type: 'error' })
      return
    }

    const sendCompanyId = composeCompanyId || companyId

    setIsSending(true)
    try {
      const now = new Date().toISOString()
      const emailId = await emailService.saveEmail({
        from: user?.name || 'HRM System',
        fromEmail: user?.email || 'hrm@company.com',
        to: composeData.toName || toList.join(', '),
        toEmail: toList.join(', '),
        cc: composeData.cc || '',
        bcc: composeData.bcc || '',
        subject: composeData.subject,
        body,
        date: now.split('T')[0],
        type: composeData.recipientGroup === 'Individual Employee' ? 'Employee' : 'Company',
        status: composeData.scheduledFor ? 'Scheduled' : 'Sent',
        read: false,
        starred: false,
        companyId: sendCompanyId || '',
        replyToId: composeData.replyToId,
        forwardOfId: composeData.forwardOfId,
        scheduledFor: composeData.scheduledFor || undefined,
        recipientGroup: composeData.recipientGroup,
      })

      if (!composeData.scheduledFor && toList.length > 0) {
        try {
          const result = await emailService.sendEmailViaSMTP({
            to: toList.join(', '),
            subject: composeData.subject,
            body,
            cc: composeData.cc || undefined,
            bcc: composeData.bcc || undefined,
            companyId: sendCompanyId || undefined,
            emailId,
          })
          if (!result.delivered) {
            setToast({ message: 'Email saved. Configure SMTP for actual delivery.', type: 'success' })
          } else {
            setToast({ message: `Email sent to ${toList.length} recipient${toList.length > 1 ? 's' : ''}!`, type: 'success' })
          }
        } catch {
          setToast({ message: 'Email saved. SMTP delivery failed — check server settings.', type: 'success' })
        }
      } else {
        setToast({ message: composeData.scheduledFor ? 'Email scheduled successfully!' : 'Email sent successfully!', type: 'success' })
      }

      setIsComposeOpen(false)
      resetCompose()
      loadEmails()
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to send email', type: 'error' })
    } finally {
      setIsSending(false)
    }
  }

  const handleSaveDraft = async () => {
    const body = editorRef.current?.innerHTML || composeData.body
    if (!composeData.subject.trim() && !body.replace(/<[^>]*>/g, '').trim()) {
      setToast({ message: 'Nothing to save', type: 'error' })
      return
    }

    const sendCompanyId = composeCompanyId || companyId

    setIsSending(true)
    try {
      const now = new Date().toISOString()
      await emailService.saveEmail({
        from: user?.name || 'HRM System',
        fromEmail: user?.email || 'hrm@company.com',
        to: composeData.toName || composeData.toEmail || '',
        toEmail: composeData.toEmail || '',
        cc: composeData.cc || '',
        bcc: composeData.bcc || '',
        subject: composeData.subject || '(no subject)',
        body,
        date: now.split('T')[0],
        type: 'Employee',
        status: 'Draft',
        read: true,
        starred: false,
        companyId: sendCompanyId || '',
        replyToId: composeData.replyToId,
        forwardOfId: composeData.forwardOfId,
        recipientGroup: composeData.recipientGroup,
      })
      setToast({ message: 'Draft saved!', type: 'success' })
      setIsComposeOpen(false)
      resetCompose()
      loadEmails()
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to save draft', type: 'error' })
    } finally {
      setIsSending(false)
    }
  }

  const handleDeleteEmail = async (id: string) => {
    try {
      await emailService.deleteEmail(id)
      loadEmails()
      setToast({ message: 'Email moved to trash', type: 'success' })
    } catch {
      setToast({ message: 'Failed to delete email', type: 'error' })
    }
  }

  const handleToggleStar = async (id: string) => {
    const email = emails.find(e => e.id === id)
    if (!email) return
    try {
      await emailService.toggleStar(id, email.starred)
      setEmails(prev => prev.map(e => e.id === id ? { ...e, starred: !email.starred } : e))
    } catch {
      setToast({ message: 'Failed to update star', type: 'error' })
    }
  }

  const handleMarkRead = async (id: string) => {
    try {
      await emailService.markAsRead(id)
      setEmails(prev => prev.map(e => e.id === id ? { ...e, read: true } : e))
    } catch {
      console.error('Failed to mark as read')
    }
  }

  const handleViewEmail = async (email: Email) => {
    setSelectedEmail(email)
    setIsViewOpen(true)
    if (!email.read && !['Draft', 'Scheduled'].includes(email.status)) {
      await handleMarkRead(email.id)
    }
  }

  const handleBulkAction = async (action: 'delete' | 'archive' | 'markRead') => {
    if (selectedEmails.length === 0) return
    try {
      await emailService.bulkAction(selectedEmails, action)
      setSelectedEmails([])
      loadEmails()
      setToast({ message: `${selectedEmails.length} emails updated`, type: 'success' })
    } catch {
      setToast({ message: 'Failed to perform bulk action', type: 'error' })
    }
  }

  const handleExport = () => {
    const csvContent = [
      ['From', 'To', 'Subject', 'Type', 'Status', 'Date'].join(','),
      ...filteredEmails.map(e => [e.from, e.to, `"${e.subject}"`, e.type, e.status, e.date].join(','))
    ].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'emails.csv'
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const handleCardFilter = (filterValue: string) => {
    const tab = filterValue as EmailTab
    setActiveTab(prev => prev === tab ? 'inbox' : tab)
    setSearchParams(prev => ({ ...Object.fromEntries(prev), tab: activeTab === tab ? 'inbox' : tab }))
  }

  const execFormat = (cmd: string) => {
    document.execCommand(cmd, false)
    if (editorRef.current) editorRef.current.focus()
  }

  const statCards = [
    { icon: Mail, label: 'Total Emails', value: stats.total, color: '#f97316', bgColor: '#fff7ed', filter: 'inbox' },
    { icon: Send, label: 'Sent', value: stats.sent, color: '#10b981', bgColor: '#ecfdf5', filter: 'sent' },
    { icon: FileText, label: 'Drafts', value: stats.drafts, color: '#8b5cf6', bgColor: '#f5f3ff', filter: 'drafts' },
    { icon: Clock, label: 'Scheduled', value: stats.scheduled, color: '#06b6d4', bgColor: '#ecfeff', filter: 'scheduled' },
    { icon: AlertCircle, label: 'Failed', value: stats.failed, color: '#ef4444', bgColor: '#fef2f2', filter: 'sent' },
    { icon: Inbox, label: 'Unread', value: stats.unread, color: '#f59e0b', bgColor: '#fffbeb', filter: 'inbox' },
  ]

  const INBOX_TABS: { key: EmailTab; icon: any; label: string; badge?: number }[] = [
    { key: 'inbox', icon: Inbox, label: 'Inbox', badge: stats.unread },
    { key: 'sent', icon: Send, label: 'Sent' },
    { key: 'drafts', icon: FileText, label: 'Drafts', badge: stats.drafts },
    { key: 'scheduled', icon: Clock, label: 'Scheduled', badge: stats.scheduled },
    { key: 'trash', icon: Trash2, label: 'Trash' },
  ]

  return (
    <div className="page-container">
      <Header title="Email Center" />
      <div className="page-content">
        {payrollFilter && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 10,
            background: '#fff7ed', border: '1px solid #fed7aa',
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          }}>
            <Filter size={16} color="#ea580c" />
            <b style={{ fontSize: 13 }}>Payroll filters applied:</b>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#c2410c' }}>
              {availableCompanies.find(c => c.id === payrollFilter.companyId)?.name || 'Selected company'} · {MONTHS[payrollFilter.monthIndex] || ''} {payrollFilter.year}
            </span>
            <span style={{ fontSize: 12, color: '#9a3412' }}>
              showing payroll emails for this period — compose is prefilled for employees of this company
            </span>
            <button className="btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setSearchParams({})}>
              <X size={14} /> Clear filters
            </button>
          </div>
        )}

        {payrollFilter && (
          <div style={{
            marginBottom: 16, padding: '14px 16px', borderRadius: 12,
            background: '#fff', border: '1px solid #fed7aa',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: '#ffedd5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ea580c', flexShrink: 0 }}>
                <Send size={16} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                  Payroll Distribution — {payrollCompanyName} · {MONTHS[payrollFilter.monthIndex] || ''} {payrollFilter.year}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
                  To: employee official email &nbsp;·&nbsp; CC: Company Admin(s) (auto) &nbsp;·&nbsp; BCC: you ({user?.email || '—'}) &nbsp;·&nbsp; Attachment: each employee's own salary-slip PDF. One isolated email per employee.
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{payrollSlipSel.size} of {payrollSlips.length} selected</span>
                <button className="btn-sm btn-secondary" onClick={() => setPayrollSlipSel(new Set(payrollSlips.map(s => s.id)))}>Select all</button>
                <button className="btn-sm btn-secondary" onClick={() => setPayrollSlipSel(new Set())}>Clear</button>
                <button
                  className="btn-sm btn-primary"
                  onClick={sendPayrollEmails}
                  disabled={payrollSending || payrollSlipsLoading || payrollSlipSel.size === 0}
                >
                  {payrollSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {payrollSending ? ' Dispatching…' : ` Send Payroll Emails (${payrollSlipSel.size})`}
                </button>
              </div>
            </div>
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #f3f4f6', borderRadius: 8 }}>
              {payrollSlipsLoading ? (
                <div className="empty-state" style={{ padding: 24 }}><Loader2 size={28} className="animate-spin" color="#d1d5db" /><p style={{ fontSize: 13 }}>Loading employees...</p></div>
              ) : payrollSlips.length === 0 ? (
                <div className="empty-state" style={{ padding: 24 }}><Users size={32} color="#d1d5db" /><p style={{ fontSize: 13 }}>No salary slips for this period yet.</p></div>
              ) : payrollSlips.map(slip => {
                const st = slipEmailStatus(slip)
                const isSelected = payrollSlipSel.has(slip.id)
                return (
                  <div key={slip.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #f3f4f6', background: isSelected ? '#fff7ed' : '#fff' }}>
                    <input type="checkbox" checked={isSelected} onChange={e => {
                      const next = new Set(payrollSlipSel)
                      if (e.target.checked) next.add(slip.id); else next.delete(slip.id)
                      setPayrollSlipSel(next)
                    }} />
                    {slip.avatar ? <img src={slip.avatar} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} /> : <div style={{ width: 28, height: 28, borderRadius: '50%', background: slip.departmentColor || '#f97316', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{(slip.employeeName || '?').charAt(0).toUpperCase()}</div>}
                    <div style={{ minWidth: 160, flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{slip.employeeName}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>{slip.department || '—'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280', minWidth: 0, flex: 1 }}>
                      <Mail size={11} style={{ flexShrink: 0 }} /> <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{slip.employeeEmail}</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#9ca3af', whiteSpace: 'nowrap', flexShrink: 0 }}>CC: Company Admin</span>
                    {st === 'Sent' ? (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#ecfdf5', color: '#059669', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>Sent</span>
                    ) : st === 'Failed' ? (
                      <button onClick={() => retrySingleSlipEmail(slip)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#fef2f2', color: '#dc2626', fontWeight: 600, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>Failed · Retry</button>
                    ) : st === 'Retrying' ? (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#fffbeb', color: '#b45309', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>Retrying…</span>
                    ) : (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#f3f4f6', color: '#6b7280', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>Not sent</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="stats-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 16, marginBottom: 20 }}>
          {statCards.slice(0, 4).map((s, i) => (
            <div
              key={i}
              className="stat-card"
              onClick={() => handleCardFilter(s.filter)}
              style={{
                cursor: 'pointer',
                background: s.bgColor,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 16,
                borderRadius: 10,
                transition: 'all 0.15s',
                border: activeTab === s.filter ? '2px solid ' + s.color : '2px solid transparent',
                boxShadow: activeTab === s.filter ? '0 0 0 3px ' + s.color + '30' : 'none'
              }}
            >
              <div style={{ width: 36, height: 36, borderRadius: 8, background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <s.icon size={18} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#1f2937' }}>{s.value}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="email-layout">
          <div className="email-sidebar">
            <button className="compose-btn" onClick={() => openCompose()}>
              <Plus size={16} />
              <span>Compose</span>
            </button>
            <div className="sidebar-tabs">
              {INBOX_TABS.map(tab => (
                <div
                  key={tab.key}
                  className={`sidebar-tab ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => { setActiveTab(tab.key); setSearchParams(prev => ({ ...Object.fromEntries(prev), tab: tab.key })) }}
                >
                  <tab.icon size={16} />
                  <span>{tab.label}</span>
                  {tab.badge && tab.badge > 0 && <span className="tab-badge">{tab.badge}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="email-list">
            <div className="email-header">
              <div className="email-search-box">
                <Search size={14} />
                <input type="text" placeholder="Search emails..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
              </div>
              <div className="email-actions">
                <select value={mailTypeFilter} onChange={e => setMailTypeFilter(e.target.value as MailType)}>
                  <option value="All">All Types</option>
                  <option value="Employee">Employee</option>
                  <option value="Department">Department</option>
                  <option value="Company">Company</option>
                  <option value="Candidate">Candidate</option>
                </select>
                <button className="btn-sm btn-secondary" onClick={loadEmails} title="Refresh"><RefreshCw size={14} /></button>
                <button className="btn-sm btn-secondary" onClick={handleExport}><Download size={14} /> Export</button>
              </div>
            </div>

            {isTLOrExec && availableCompanies.length >= 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #e5e7eb', background: '#fafafa' }}>
                <Building2 size={14} style={{ color: '#6b7280', flexShrink: 0 }} />
                <select
                  value={listCompanyId}
                  onChange={e => setListCompanyId(e.target.value)}
                  style={{ padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, background: '#fff' }}
                >
                  <option value="">All Companies ({availableCompanies.length})</option>
                  {availableCompanies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {user?.role === 'team-leader' && tlExecutives.length > 1 && (
                  <>
                    <span style={{ color: '#d1d5db', fontSize: 12 }}>|</span>
                    <select
                      value={listCompanyId ? '' : ''}
                      disabled
                      style={{ padding: '5px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, background: '#f9fafb', color: '#9ca3af' }}
                    >
                      <option>All Executives</option>
                    </select>
                  </>
                )}
                <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
                  {filteredEmails.length} email{filteredEmails.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {selectedEmails.length > 0 && (
              <div className="bulk-actions">
                <span>{selectedEmails.length} selected</span>
                <button className="btn-sm btn-secondary" onClick={() => handleBulkAction('markRead')}>Mark Read</button>
                <button className="btn-sm btn-secondary" onClick={() => handleBulkAction('archive')}>Archive</button>
                <button className="btn-sm btn-danger" onClick={() => handleBulkAction('delete')}>Delete</button>
                <button className="btn-sm btn-secondary" onClick={() => setSelectedEmails([])}><X size={14} /> Clear</button>
              </div>
            )}

            <div className="email-items">
              {loading ? (
                <div className="empty-state">
                  <Loader2 className="animate-spin" size={32} color="#d1d5db" />
                  <p>Loading emails...</p>
                </div>
              ) : paginated.length === 0 ? (
                <div className="empty-state">
                  <Mail size={48} color="#d1d5db" />
                  <p>No emails found{companyName ? ` for ${companyName}` : ''}</p>
                </div>
              ) : paginated.map(email => (
                <div
                  key={email.id}
                  className={`email-item ${!email.read ? 'unread' : ''} ${selectedEmails.includes(email.id) ? 'selected' : ''}`}
                  onClick={() => handleViewEmail(email)}
                >
                  <input type="checkbox" checked={selectedEmails.includes(email.id)} onChange={e => {
                    e.stopPropagation()
                    setSelectedEmails(prev => e.target.checked ? [...prev, email.id] : prev.filter(id => id !== email.id))
                  }} />
                  <button className="star-btn" style={{ background: 'none', border: 'none', cursor: 'pointer', color: email.starred ? '#f59e0b' : '#d1d5db' }} onClick={e => { e.stopPropagation(); handleToggleStar(email.id) }}>
                    <Star size={14} fill={email.starred ? '#f59e0b' : 'none'} />
                  </button>
                  <div className="email-info">
                    <div className="email-top">
                      <span className="email-from">{email.from}</span>
                      <span className="email-date">{email.date}</span>
                    </div>
                    <div className="email-subject">{email.subject}</div>
                    <div className="email-preview">{email.body?.replace(/<[^>]*>/g, '').slice(0, 80)}...</div>
                  </div>
                  <span className={`email-status status-${email.status?.toLowerCase()}`}>{email.status}</span>
                </div>
              ))}
            </div>

            <div className="pagination">
              <span className="pagination-info">
                {filteredEmails.length > 0
                  ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, filteredEmails.length)} of ${filteredEmails.length}`
                  : 'No results'}
              </span>
              <div className="pagination-controls">
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}>
                  <option value={10}>10/page</option>
                  <option value={25}>25/page</option>
                  <option value={50}>50/page</option>
                </select>
                <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft size={16} /></button>
                <span className="pagination-page">{currentPage} / {totalPages || 1}</span>
                <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}><ChevronRight size={16} /></button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* COMPOSE MODAL */}
      <Modal isOpen={isComposeOpen} onClose={() => { setIsComposeOpen(false); resetCompose() }} title={composeData.replyToId ? 'Reply' : composeData.forwardOfId ? 'Forward' : 'Compose Email'} size="large">
        <div className="compose-email">
          <div className="compose-header" style={{ position: 'relative' }}>
            <button className={`template-btn ${showTemplates ? 'active' : ''}`} onClick={() => setShowTemplates(!showTemplates)}>
              <FileText size={14} /> Templates
            </button>
            {showTemplates && (
              <div className="templates-dropdown">
                {TEMPLATES.map(t => (
                  <div key={t.id} className="template-option" onClick={() => handleTemplateSelect(t)}>
                    <span className="template-name">{t.name}</span>
                    <span className="template-cat">{t.category}</span>
                  </div>
                ))}
              </div>
            )}
            {composeData.replyToId && <span className="template-cat" style={{ marginLeft: 8 }}>Replying to message</span>}
            {composeData.forwardOfId && <span className="template-cat" style={{ marginLeft: 8 }}>Forwarding message</span>}
          </div>

          {isTLOrExec && !composeData.replyToId && composeCompanies.length >= 1 && (
            <>
              {user?.role === 'team-leader' && tlExecutives.length > 1 && (
                <div className="compose-field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <User size={14} /> Filter by Executive
                  </label>
                  <select
                    value={selectedExecId}
                    onChange={e => handleExecFilterChange(e.target.value)}
                  >
                    <option value="">All Executives ({tlExecutives.length})</option>
                    {tlExecutives.map(ex => (
                      <option key={ex.id} value={ex.id}>{ex.name} ({ex.assignedCompanyIds.length} companies)</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="compose-field">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={14} /> Filter by Company
                </label>
                <select
                  value={composeCompanyId}
                  onChange={e => handleCompanyFilterChange(e.target.value)}
                >
                  <option value="">— Select company scope —</option>
                  <option value="all">All Companies ({composeCompanies.length})</option>
                  {composeCompanies.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="compose-field">
            <label>Recipient Group</label>
            <select
              value={composeData.recipientGroup}
              onChange={e => handleRecipientGroupChange(e.target.value)}
              disabled={!!composeData.replyToId}
            >
              {RECIPIENT_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>

          {resolvedRecipients.length > 0 && (
            <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {resolvedRecipients.slice(0, 5).map(r => (
                <span key={r.email} style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>
                  {r.name} &lt;{r.email}&gt;
                </span>
              ))}
              {resolvedRecipients.length > 5 && <span>+{resolvedRecipients.length - 5} more</span>}
            </div>
          )}

          {isTLOrExec && composeCompanyId && !composeData.replyToId && (
            <div className="compose-field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={14} /> Select Employees
                {selectedEmployeeIds.size > 0 && (
                  <span style={{ background: '#f97316', color: '#fff', padding: '1px 6px', borderRadius: 10, fontSize: 11 }}>
                    {selectedEmployeeIds.size}
                  </span>
                )}
                {composeCompanyId === 'all' && (
                  <span style={{ fontSize: 11, color: '#8b5cf6', background: '#f5f3ff', padding: '1px 6px', borderRadius: 4 }}>
                    across {composeCompanies.length} companies
                  </span>
                )}
              </label>
              {loadingEmployees ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#6b7280' }}>
                  <Loader2 className="animate-spin" size={16} style={{ marginRight: 6 }} />
                  Loading employees...
                </div>
              ) : employeeList.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                  No active employees found in this company
                </div>
              ) : (
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                  <label
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', borderBottom: '1px solid #e5e7eb',
                      background: '#f9fafb', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmployeeIds.size === employeeList.length && employeeList.length > 0}
                      onChange={handleSelectAllEmployees}
                    />
                    Select All ({employeeList.length})
                  </label>
                  {employeeList.map(emp => (
                    <label
                      key={emp.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 12px', borderBottom: '1px solid #f3f4f6',
                        cursor: 'pointer', fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedEmployeeIds.has(emp.id)}
                        onChange={() => handleToggleEmployee(emp)}
                      />
                      <span style={{ fontWeight: 500 }}>{emp.name}</span>
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>&lt;{emp.email}&gt;</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {!composeData.replyToId && (
            <div className="compose-field">
              <label>To *</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="email@company.com (comma-separated for multiple)"
                  value={composeData.toEmail}
                  onChange={e => setComposeData(p => ({ ...p, toEmail: e.target.value }))}
                  style={{ flex: 1 }}
                />
                {composeData.recipientGroup === 'Individual Employee' && resolvedRecipients.length > 0 && (
                  <button className="btn-sm btn-secondary" onClick={() => setShowRecipientPicker(!showRecipientPicker)}>
                    <Users size={14} />
                  </button>
                )}
              </div>
            </div>
          )}

          {showRecipientPicker && resolvedRecipients.length > 0 && (
            <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {resolvedRecipients.map(r => (
                <label key={r.email} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', background: '#f9fafb', borderRadius: 4, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={composeData.toEmail.includes(r.email)}
                    onChange={e => {
                      const emails = emailService.parseEmails(composeData.toEmail)
                      setComposeData(p => ({
                        ...p,
                        toEmail: e.target.checked
                          ? [...emails, r.email].join(', ')
                          : emails.filter(em => em !== r.email).join(', ')
                      }))
                    }}
                  />
                  {r.name} ({r.email})
                </label>
              ))}
            </div>
          )}

          {!composeData.replyToId && (
            <>
              <div className="compose-field">
                <label>CC</label>
                {!showCC && <button className="toggle-cc" onClick={() => setShowCC(true)}>Add CC</button>}
                {showCC && <input type="text" placeholder="CC recipients..." value={composeData.cc} onChange={e => setComposeData(p => ({ ...p, cc: e.target.value }))} />}
              </div>
              <div className="compose-field">
                <label>BCC</label>
                {!showBCC && <button className="toggle-cc" onClick={() => setShowBCC(true)}>Add BCC</button>}
                {showBCC && <input type="text" placeholder="BCC recipients..." value={composeData.bcc} onChange={e => setComposeData(p => ({ ...p, bcc: e.target.value }))} />}
              </div>
            </>
          )}

          <div className="compose-field">
            <label>Subject *</label>
            <input type="text" placeholder="Email subject..." value={composeData.subject} onChange={e => setComposeData(p => ({ ...p, subject: e.target.value }))} />
          </div>

          {selectedTemplate && templateVars && Object.keys(templateVars).length > 0 && (
            <div className="compose-field">
              <label>Template Variables</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(templateVars).map(([key, val]) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11, color: '#8b5cf6', background: '#f5f3ff', padding: '2px 6px', borderRadius: 4 }}>{`{${key}}`}</span>
                    <input
                      style={{ width: 120, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 12 }}
                      placeholder={key}
                      value={val}
                      onChange={e => setTemplateVars(prev => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                ))}
                <button className="btn-sm btn-secondary" onClick={applyTemplateVars} style={{ fontSize: 11 }}>Apply</button>
              </div>
            </div>
          )}

          <div className="compose-field">
            <label>Body *</label>
            <div className="rich-text-toolbar">
              <button type="button" onClick={() => execFormat('bold')} title="Bold"><Bold size={14} /></button>
              <button type="button" onClick={() => execFormat('italic')} title="Italic"><Italic size={14} /></button>
              <button type="button" onClick={() => execFormat('underline')} title="Underline"><Underline size={14} /></button>
              <button type="button" onClick={() => execFormat('insertUnorderedList')} title="List"><List size={14} /></button>
              <button type="button" onClick={() => {
                const url = prompt('Enter link URL:')
                if (url) { document.execCommand('createLink', false, url); if (editorRef.current) editorRef.current.focus() }
              }} title="Link"><LinkIcon size={14} /></button>
            </div>
            <div
              ref={editorRef}
              className="rich-text-editor"
              contentEditable
              suppressContentEditableWarning
              onInput={e => setComposeData(p => ({ ...p, body: (e.target as HTMLDivElement).innerHTML }))}
            />
          </div>

          <div className="compose-field">
            <label>Schedule (optional)</label>
            <input
              type="datetime-local"
              value={composeData.scheduledFor || ''}
              onChange={e => setComposeData(p => ({ ...p, scheduledFor: e.target.value }))}
            />
          </div>

          <div className="compose-footer">
            <button className="btn-secondary" onClick={() => { setIsComposeOpen(false); resetCompose() }}>Cancel</button>
            <button className="btn-secondary" onClick={handleSaveDraft} disabled={isSending}>
              <FileText size={14} /> {isSending ? 'Saving...' : 'Save Draft'}
            </button>
            <button className="btn-primary" onClick={handleSend} disabled={isSending}>
              <Send size={14} /> {isSending ? 'Sending...' : composeData.scheduledFor ? 'Schedule' : 'Send'}
            </button>
          </div>
        </div>
      </Modal>

      {/* VIEW EMAIL MODAL */}
      <Modal isOpen={isViewOpen} onClose={() => setIsViewOpen(false)} title="Email Details" size="large">
        {selectedEmail && (
          <div className="view-email">
            <div className="email-detail-header">
              <div>
                <h3>{selectedEmail.subject}</h3>
                <p className="email-detail-from">From: {selectedEmail.from} &lt;{selectedEmail.fromEmail}&gt;</p>
                <p className="email-detail-to">To: {selectedEmail.to} &lt;{selectedEmail.toEmail}&gt;</p>
                {selectedEmail.cc && <p className="email-detail-cc">CC: {selectedEmail.cc}</p>}
                {selectedEmail.bcc && <p className="email-detail-bcc">BCC: {selectedEmail.bcc}</p>}
                <p className="email-detail-date">Date: {selectedEmail.date}</p>
              </div>
              <div className="email-detail-actions">
                <button className="btn-sm btn-secondary" onClick={() => handleToggleStar(selectedEmail.id)}>
                  <Star size={14} fill={selectedEmail.starred ? '#f59e0b' : 'none'} style={{ color: selectedEmail.starred ? '#f59e0b' : '#6b7280' }} />
                </button>
                <button className="btn-sm btn-secondary" onClick={() => { setIsViewOpen(false); handleReply(selectedEmail) }}>
                  <Reply size={14} /> Reply
                </button>
                <button className="btn-sm btn-secondary" onClick={() => { setIsViewOpen(false); handleForward(selectedEmail) }}>
                  <Forward size={14} /> Forward
                </button>
                <button className="btn-sm btn-danger" onClick={() => { handleDeleteEmail(selectedEmail.id); setIsViewOpen(false) }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="email-detail-body" dangerouslySetInnerHTML={{ __html: selectedEmail.body }} />
            <div className="email-detail-tracking">
              <h4>Tracking</h4>
              <div className="tracking-statuses">
                <span className={`tracking-badge ${['Sent', 'Delivered', 'Opened', 'Clicked'].includes(selectedEmail.status) ? 'active' : ''}`}>
                  <Send size={12} /> Sent
                </span>
                <span className={`tracking-badge ${['Delivered', 'Opened', 'Clicked'].includes(selectedEmail.status) ? 'active' : ''}`}>
                  <CheckCircle size={12} /> Delivered
                </span>
                <span className={`tracking-badge ${['Opened', 'Clicked'].includes(selectedEmail.status) ? 'active' : ''}`}>
                  <Eye size={12} /> Opened
                </span>
                <span className={`tracking-badge ${selectedEmail.status === 'Clicked' ? 'active' : ''}`}>
                  <CheckCircle size={12} /> Clicked
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  )
}
