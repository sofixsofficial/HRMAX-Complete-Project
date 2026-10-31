import { useState, useEffect, useMemo } from 'react'
import { errText } from '../aws/errors';
import {
  CalendarDays, CalendarClock, Clock, Edit3, AlertCircle, Info,
  Wallet, ArrowRight, CheckCircle2, Loader2, Eye,
} from 'lucide-react'
import { collection, query, where, onSnapshot } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { Pagination } from '../components/Pagination'
import { LeaveApplyModal } from '../components/LeaveApplyModal'
import { AttendancePunchBanner } from '../components/AttendancePunchBanner'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { useEmployeePersonalStats } from '../hooks/useEmployeePersonalStats'
import { getEmployeeByUserId } from '../services/employeeService'
import { computeLeaveBalance, LEAVE_TYPES, TIER_LABELS, getEffectiveTiers, resolveEmployeeLeaveEntitlements } from '../services/leaveService'
import type { LeaveBalanceConfig } from '../services/leaveService'
import { resolveEmployeeLeavePolicy } from '../services/leavePolicyService'
import { requestPunchRectification, resolveAttendanceCorrectionWindow, getRecordEffectiveMissedPunchTiers, MISSED_PUNCH_TIER_LABELS } from '../services/attendanceService'
import { isWithinAttendanceCorrectionWindow } from '../utils/workingDays'
import { isActiveMissedPunchRecord } from '../utils/attendanceStatus'
import { notifyAttendanceCascade } from '../services/attendanceNotifier'
import { logAudit } from '../services/auditLogService'
import type { AttendanceRecord, LeaveRequest, LeaveType, UserRole, ApprovalTier } from '../types/user'
import './Dashboard.css'

type TabKey = 'leaves' | 'attendance' | 'missed'
type LeaveFilter = 'All' | 'Pending' | 'Approved' | 'Rejected'

const MA_ROLES = new Set<UserRole>(['team-leader', 'executive'])

// Reporting Manager self-applications follow their own 3-tier chain (their own
// Reporting Manager tier auto-completes): Company Admin → Executive → Team Leader.
const RM_CHAIN = 'Company Admin → Executive → Team Leader'
const MP_MISSED_PUNCH_CHAIN = 'Reporting Manager → HR → Company Admin → Executive → Team Leader'

const ROLE_LABELS: Record<string, string> = {
  'team-leader': 'Team Leader',
  'executive': 'Executive',
  'reporting-manager': 'Reporting Manager',
  'employee': 'Employee',
}

const toDate = (v: any): Date | null => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  if (v instanceof Date) return v
  return null
}

const fmtTime = (v: any): string => {
  const d = toDate(v)
  if (!d) return '--'
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

const fmtDate = (v: any): string => {
  const d = toDate(v)
  if (!d) return '--'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const fmtShortDate = (v: any): string => {
  const d = toDate(v)
  if (!d) return '--'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

const weekday = (v: any): string => {
  const d = toDate(v)
  if (!d) return '--'
  return d.toLocaleDateString('en-IN', { weekday: 'short' })
}

const attendanceColor = (s?: string): string => {
  switch (s) {
    case 'Present': return '#16a34a'
    case 'Late': return '#d97706'
    case 'Absent': return '#dc2626'
    case 'On Leave': return '#2563eb'
    case 'Miss Punch': return '#7c3aed'
    case 'Approved': return '#16a34a'
    default: return '#6b7280'
  }
}

const levelColor = (s?: string): string => {
  switch (s) {
    case 'Approved': return '#16a34a'
    case 'Rejected': return '#dc2626'
    default: return '#d97706'
  }
}

const leaveStatusColor = (s?: string): string => {
  switch (s) {
    case 'Approved': return '#16a34a'
    case 'Rejected': return '#dc2626'
    case 'On Hold': return '#6b7280'
    default: return '#d97706'
  }
}

interface ApprovalStep {
  key: string
  label: string
  status: string
  approvedByName?: string
  note?: string
}

const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #eef0f3',
  borderRadius: 14,
  boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
}

const TH_TEXT: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: '#6b7280',
  background: '#f9fafb',
  borderBottom: '1px solid #e5e7eb',
}

const TD_TEXT: React.CSSProperties = {
  padding: '12px 16px',
  verticalAlign: 'middle',
}

export function MyLeavesAttendance() {
  const { user } = useAuth()
  const { effectiveCompanyId, availableCompanies } = useCompany()
  const personal = useEmployeePersonalStats()

  const [tab, setTab] = useState<TabKey>('leaves')
  const [leaveFilter, setLeaveFilter] = useState<LeaveFilter>('All')
  const [leavesPage, setLeavesPage] = useState(1)
  const [leavesPageSize, setLeavesPageSize] = useState(10)
  const [attendancePage, setAttendancePage] = useState(1)
  const [attendancePageSize, setAttendancePageSize] = useState(10)
  const [allowances, setAllowances] = useState<Record<string, number>>({})
  const [policyCfg, setPolicyCfg] = useState<LeaveBalanceConfig | undefined>(undefined)
  const [hasMonthlyEntitlements, setHasMonthlyEntitlements] = useState(false)
  const [joinDate, setJoinDate] = useState<Date | null | undefined>(undefined)
  const [myLeaves, setMyLeaves] = useState<LeaveRequest[]>([])
  const [nameByUid, setNameByUid] = useState<Record<string, string>>({})
  const [showApplyLeave, setShowApplyLeave] = useState(false)

  const [rectifyModal, setRectifyModal] = useState<AttendanceRecord | null>(null)
  const [rectifyTime, setRectifyTime] = useState('')
  const [rectifyRemark, setRectifyRemark] = useState('')
  const [submittingRectify, setSubmittingRectify] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const userId = user?.id || ''
  const role = user?.role as UserRole
  const roleLabel = ROLE_LABELS[role] || role || ''
  const isManagement = MA_ROLES.has(role)
  const isRM = role === 'reporting-manager'
  // All-Companies mode (Executive/Team-Leader): effectiveCompanyId is null and
  // the user doc carries `global` — resolve a real company so leave policy,
  // correction window, holidays and Apply-Leave all work (the `global`
  // placeholder 403'd leave-create and resolved no policy/holidays).
  const companyId = [effectiveCompanyId, availableCompanies?.[0]?.id, user?.companyId]
    .map(v => String(v ?? ''))
    .find(v => v && v !== 'global') ?? ''

  const mapLeave = (d: any): LeaveRequest => ({
    ...d,
    // Backend stores the type under `type` — normalize so lists/detail never
    // render an empty Leave Type.
    leaveType: d.leaveType || d.type || 'Casual',
    startDate: toDate(d.startDate)!,
    endDate: toDate(d.endDate)!,
    appliedOn: toDate(d.appliedOn)!,
  })

  useEffect(() => {
    if (!userId) {
      setMyLeaves([])
      return
    }
    const unsub = onSnapshot(
      query(collection(db, 'leaveRequests'), where('userId', '==', userId)),
      (snap) => {
        const docs = snap.docs.map((s) => mapLeave(s.data()))
        docs.sort((a, b) =>
          (toDate(b.appliedOn)?.getTime() || 0) - (toDate(a.appliedOn)?.getTime() || 0)
        )
        setMyLeaves(docs)
      },
      () => setMyLeaves([])
    )
    return () => unsub()
  }, [userId])

  useEffect(() => {
    if (!companyId) {
      setAllowances({})
      setPolicyCfg(undefined)
      setHasMonthlyEntitlements(false)
      return
    }
    let cancelled = false
    getEmployeeByUserId(userId)
      .then(async (emp) => {
        const entitlements = resolveEmployeeLeaveEntitlements(emp)
        if (cancelled) return
        if (entitlements) {
          setAllowances(entitlements.yearly)
          setPolicyCfg(entitlements.config)
          setHasMonthlyEntitlements(true)
        } else {
          const resolved = await resolveEmployeeLeavePolicy(companyId, emp?.leavePolicyId)
          if (cancelled) return
          setAllowances(resolved.allowances)
          setPolicyCfg(resolved.config)
          setHasMonthlyEntitlements(false)
        }
      })
      .catch(() => { if (!cancelled) { setAllowances({}); setPolicyCfg(undefined); setHasMonthlyEntitlements(false) } })
    return () => { cancelled = true }
  }, [companyId, userId])

  // Company calendar for the 2-working-day missed-punch / leave re-submission window.
  const [correctionWindow, setCorrectionWindow] = useState<{ weekendDays: number[]; holidayKeys: string[] } | null>(null)
  useEffect(() => {
    let active = true
    if (!companyId) { setCorrectionWindow(null); return }
    resolveAttendanceCorrectionWindow(companyId).then(w => { if (active) setCorrectionWindow(w) }).catch(() => {})
    return () => { active = false }
  }, [companyId])
  const windowClosed = (d: any) => {
    const from = toDate(d)
    if (!from || !correctionWindow) return false
    return !isWithinAttendanceCorrectionWindow(from, new Date(), correctionWindow.weekendDays, correctionWindow.holidayKeys)
  }
  const leaveWindowClosed = (l: LeaveRequest) => {
    if (!correctionWindow) return false
    const from = toDate(l.rejectedAt) || toDate(l.reviewedOn) || toDate(l.appliedOn)
    if (!from) return false
    return !isWithinAttendanceCorrectionWindow(from, new Date(), correctionWindow.weekendDays, correctionWindow.holidayKeys)
  }
  const toInput = (d: any) => {
    const dt = toDate(d)
    if (!dt) return ''
    const m = String(dt.getMonth() + 1).padStart(2, '0')
    const day = String(dt.getDate()).padStart(2, '0')
    return `${dt.getFullYear()}-${m}-${day}`
  }
  const [resubmittingLeave, setResubmittingLeave] = useState<{ leaveType: LeaveType; startDate: string; endDate: string } | null>(null)
  const [viewLeave, setViewLeave] = useState<LeaveRequest | null>(null)
  const [viewAttendance, setViewAttendance] = useState<AttendanceRecord | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getEmployeeByUserId(userId)
      .then(emp => { if (!cancelled) setJoinDate(emp?.joinDate || undefined) })
      .catch(() => { if (!cancelled) setJoinDate(undefined) })
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    if (!userId) return
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('role', 'in', ['team-leader', 'executive', 'master-admin', 'company-admin'])),
      (snap) => {
        const map: Record<string, string> = {}
        snap.docs.forEach((d) => {
          const data = d.data()
          if (data.name) map[d.id] = data.name
        })
        setNameByUid(map)
      },
      () => setNameByUid({})
    )
    return () => unsub()
  }, [userId])

  const balance = useMemo(
    () => computeLeaveBalance(allowances, myLeaves, userId, new Date().getFullYear(), joinDate, policyCfg, hasMonthlyEntitlements),
    [allowances, myLeaves, userId, joinDate, policyCfg, hasMonthlyEntitlements]
  )

  const sortedRecords = useMemo(
    () => [...personal.monthRecords].sort(
      (a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0)
    ),
    [personal.monthRecords]
  )

  const unresolvedMissPunches = useMemo(
    () => sortedRecords.filter(
      (r) => isActiveMissedPunchRecord(r)
    ),
    [sortedRecords]
  )

  const pendingCount = myLeaves.filter((l) => l.status === 'Pending').length

  const filteredLeaves = useMemo(() => {
    if (leaveFilter === 'All') return myLeaves
    return myLeaves.filter((l) => l.status === leaveFilter)
  }, [myLeaves, leaveFilter])

  // Back to page 1 whenever the leave status filter changes
  useEffect(() => {
    setLeavesPage(1)
  }, [leaveFilter])

  const leavesSafePage = Math.min(leavesPage, Math.max(1, Math.ceil(filteredLeaves.length / leavesPageSize)))
  const pagedLeaves = filteredLeaves.slice((leavesSafePage - 1) * leavesPageSize, leavesSafePage * leavesPageSize)

  const attendanceSafePage = Math.min(attendancePage, Math.max(1, Math.ceil(sortedRecords.length / attendancePageSize)))
  const pagedRecords = sortedRecords.slice((attendanceSafePage - 1) * attendancePageSize, attendanceSafePage * attendancePageSize)

  const getApprovalSteps = (leave: LeaveRequest): ApprovalStep[] => {
    const applicant = leave.applicantRole
    // Role-aware chain via the shared helper: Employee = 4 tiers, Reporting
    // Manager = 3 (own tier auto-completed), Executive = Team Leader (+ Master
    // Admin gate), Team Leader = Master Admin only (direct routing).
    const steps: ApprovalStep[] = getEffectiveTiers(applicant).map((tier) => ({
      key: tier,
      label: TIER_LABELS[tier],
      status: leave.approvalStatus?.[tier] || 'Pending',
      approvedByName: leave.approvalLog?.find((e) => e.tier === tier)?.approvedByName,
    }))
    if (leave.masterAdminRequired) {
      steps.push({
        key: 'masterAdmin',
        label: 'Master Admin',
        status: leave.masterAdminApproveStatus || 'Pending',
        approvedByName: leave.masterAdminApprovedByName || nameByUid[leave.masterAdminApproverId || ''],
        note: leave.masterAdminNote,
      })
    }
    return steps
  }

  const handleRectifyRequest = async () => {
    if (!rectifyModal || !rectifyTime || !user) return
    setSubmittingRectify(true)
    try {
      const [h, m] = rectifyTime.split(':').map(Number)
      const corrected = new Date(toDate(rectifyModal.date) || new Date())
      corrected.setHours(h, m, 0, 0)
      await requestPunchRectification(rectifyModal.id, corrected, rectifyRemark || undefined)
      await notifyAttendanceCascade({
        companyId: rectifyModal.companyId,
        employeeUserId: user.id,
        employeeName: user.name,
        kind: 'rectification-requested',
        dateLabel: fmtDate(rectifyModal.date),
        actorName: user.name,
      })
      logAudit({
        userId: user.id, userName: user.name, userRole: user.role,
        action: `Requested missed punch rectification for ${fmtDate(rectifyModal.date)}`,
        actionType: 'update', module: 'Attendance', targetEntity: rectifyModal.name, status: 'success',
      })
      setActionMsg({
        type: 'success',
        text: rectificationRoutedToMA
          ? 'Rectification routed to Master Admin for review.'
          : isRM
            ? `Rectification routed through: ${MP_MISSED_PUNCH_CHAIN}.`
            : 'Rectification submitted for review.',
      })
      setRectifyModal(null)
      setRectifyTime('')
      setRectifyRemark('')
    } catch (err: any) {
      setActionMsg({ type: 'error', text: errText(err, 'Failed to submit rectification') })
    } finally {
      setSubmittingRectify(false)
    }
  }

  const rectificationRoutedToMA = isManagement

  const todayRecord = personal.todayRecord
  const todayCompleted = !!todayRecord?.checkIn && !!todayRecord?.checkOut
  const todayStatus = todayCompleted
    ? 'Completed'
    : todayRecord?.status || (todayRecord ? 'Checked In' : 'Not Checked In')

  const stepPill = (step: ApprovalStep) => {
    const color = levelColor(step.status)
    return (
      <span
        key={step.key}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600,
          background: `${color}12`, color,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
        {step.label}: {step.status}
      </span>
    )
  }

  const approvalCell = (leave: LeaveRequest) => {
    const steps = getApprovalSteps(leave)
    const names = steps.filter((s) => s.approvedByName).map((s) => `${s.label}: ${s.approvedByName}`)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          {steps.map((s, i) => (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {i > 0 ? <ArrowRight size={11} style={{ color: '#cbd5e1' }} /> : null}
              {stepPill(s)}
            </span>
          ))}
        </div>
        {names.length > 0 && (
          <div style={{ fontSize: 11, color: '#9ca3af' }}>{names.join(' · ')}</div>
        )}
        {steps.find((s) => s.key === 'masterAdmin')?.note ? (
          <div style={{ fontSize: 11, color: '#9ca3af' }}>MA note: {steps.find((s) => s.key === 'masterAdmin')?.note}</div>
        ) : null}
      </div>
    )
  }

  if (!user) return null

  const monthStats = personal.monthStats

  return (
    <div className="page-container">
      <Header title="My Leaves & Attendance" breadcrumbs={['Dashboard', 'My Leaves & Attendance']} />
      <div className="page-content">

        {actionMsg && (
          <div style={{
            padding: '9px 14px', borderRadius: 10, marginBottom: 14,
            background: actionMsg.type === 'success' ? '#ecfdf5' : '#fef2f2',
            color: actionMsg.type === 'success' ? '#059669' : '#dc2626',
            fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8,
            border: `1px solid ${actionMsg.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
          }}>
            {actionMsg.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span style={{ flex: 1 }}>{actionMsg.text}</span>
            <button onClick={() => setActionMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>&times;</button>
          </div>
        )}

        {/* Mandatory orange check-in / check-out banner (all roles) */}
        <AttendancePunchBanner />

        {/* Quick actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowApplyLeave(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, boxShadow: '0 1px 2px rgba(124,58,237,0.25)' }}
          >
            <CalendarClock size={14} /> Apply Leave
          </button>
          <button
            onClick={() => setTab('attendance')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: '1px solid #e5e7eb', background: tab === 'attendance' ? '#f3f4f6' : '#fff', color: '#374151', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            title="View your personal attendance history"
          >
            <Clock size={14} /> Attendance
          </button>
        </div>

        {/* Today strip */}
        <div style={{ ...CARD, padding: '16px 20px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 240 }}>
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: attendanceColor(todayRecord?.status), flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.6 }}>Today</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: attendanceColor(todayRecord?.status) }}>{todayStatus}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {todayRecord?.checkIn ? `In ${fmtTime(todayRecord.checkIn)}` : 'No check-in'}
                {todayRecord?.checkOut ? ` · Out ${fmtTime(todayRecord.checkOut)}` : ''}
              </div>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[
              { label: 'Present', value: monthStats.present },
              { label: 'Late', value: monthStats.late },
              { label: 'Absent', value: monthStats.absent },
              { label: 'Leave', value: monthStats.onLeave },
              { label: 'Open', value: unresolvedMissPunches.length },
            ].map((s) => (
              <div key={s.label} style={{ textAlign: 'center', minWidth: 56 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{s.value}</div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Balances */}
        <div style={{ ...CARD, padding: '16px 20px', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Wallet size={15} style={{ color: '#7c3aed' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Leave Balances · {new Date().getFullYear()}</span>
            {pendingCount > 0 && <span style={{ marginLeft: 'auto', fontSize: 12, color: '#d97706', fontWeight: 600 }}>{pendingCount} pending</span>}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {LEAVE_TYPES.map((t) => {
              const entry = balance[t as LeaveType]
              if (!entry) return null
              if (entry.allowance <= 0 && entry.used <= 0) return null
              return (
                <div key={t} style={{ flex: '1 1 120px', minWidth: 120, padding: '10px 14px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f0f2f5' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>{t}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginTop: 2 }}>
                    {entry.available}<span style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af' }}> left</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    {entry.monthly !== undefined && entry.monthly > 0 ? `${entry.monthly}/mo · ` : ''}{entry.used} used / {entry.allowance} yearly
                  </div>
                  {entry.pending > 0 && <div style={{ fontSize: 11, color: '#6366f1', marginTop: 2 }}>+{entry.pending} pending</div>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 10, background: '#f3f4f6', marginBottom: 18, maxWidth: '100%', overflowX: 'auto' }}>
          {([
            { key: 'leaves', label: 'My Leaves', count: myLeaves.length },
            { key: 'attendance', label: 'Attendance', count: sortedRecords.length },
            { key: 'missed', label: 'Missed Punches', count: unresolvedMissPunches.length, accent: unresolvedMissPunches.length > 0 },
          ] as Array<{ key: TabKey; label: string; count: number; accent?: boolean }>).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 8,
                border: 'none',
                background: tab === t.key ? '#fff' : 'transparent',
                color: tab === t.key ? '#111827' : '#6b7280',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
                boxShadow: tab === t.key ? '0 1px 2px rgba(16,24,40,0.08)' : 'none',
              }}
            >
              {t.label}
              <span style={{
                padding: '0 7px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                background: t.accent ? '#f3e8ff' : '#eef0f3', color: t.accent ? '#7c3aed' : '#6b7280',
              }}>{t.count}</span>
            </button>
          ))}
        </div>

        {tab === 'leaves' && (
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 16px', borderBottom: '1px solid #eef0f3', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginRight: 6 }}>My Leave Requests</span>
              {(['All', 'Pending', 'Approved', 'Rejected'] as LeaveFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setLeaveFilter(f)}
                  style={{
                    padding: '4px 12px', borderRadius: 999, border: '1px solid',
                    cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: leaveFilter === f ? '#7c3aed' : '#fff',
                    borderColor: leaveFilter === f ? '#7c3aed' : '#e5e7eb',
                    color: leaveFilter === f ? '#fff' : '#6b7280',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
            {filteredLeaves.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <CalendarDays size={30} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.35 }} />
                <div style={{ fontSize: 14, color: '#9ca3af' }}>
                  {myLeaves.length === 0 ? 'No leave requests yet. Use "Apply Leave" to request time off.' : `No ${leaveFilter.toLowerCase()} leaves.`}
                </div>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={TH_TEXT}>Dates</th>
                      <th style={TH_TEXT}>Type</th>
                      <th style={TH_TEXT}>Days</th>
                      <th style={TH_TEXT}>Status</th>
                      <th style={TH_TEXT}>Approval</th>
                      <th style={TH_TEXT}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedLeaves.map((leave) => (
                      <tr key={leave.id}>
                        <td style={TD_TEXT}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{fmtShortDate(leave.startDate)} – {fmtShortDate(leave.endDate)}</div>
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>Applied {fmtShortDate(leave.appliedOn)}</div>
                        </td>
                        <td style={TD_TEXT}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{leave.leaveType || 'Other'}</div>
                          {!leave.isPaid ? <div style={{ fontSize: 11, color: '#9ca3af' }}>Unpaid</div> : null}
                        </td>
                        <td style={{ ...TD_TEXT, fontWeight: 600 }}>{leave.totalDays || 1}</td>
                        <td style={TD_TEXT}>
                          <span style={{
                            padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                            background: `${leaveStatusColor(leave.status)}12`, color: leaveStatusColor(leave.status),
                          }}>
                            {leave.status}
                          </span>
                        </td>
                        <td style={TD_TEXT}>{approvalCell(leave)}</td>
                        <td style={TD_TEXT}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              onClick={() => setViewLeave(leave)}
                              title="View details & approval progress"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                            >
                              <Eye size={13} /> View
                            </button>
                            {leave.status === 'Rejected' && (
                              leaveWindowClosed(leave) ? (
                                <span style={{ fontSize: 12, color: '#9ca3af' }}>Final</span>
                              ) : (
                                <button
                                  onClick={() => { setResubmittingLeave({ leaveType: leave.leaveType, startDate: toInput(leave.startDate), endDate: toInput(leave.endDate) }); setShowApplyLeave(true) }}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 7, border: '1px solid #7c3aed', background: '#fff', color: '#7c3aed', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                                >
                                  <Edit3 size={12} /> Re-submit
                                </button>
                              )
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filteredLeaves.length > 0 && (
              <Pagination
                page={leavesSafePage}
                pageSize={leavesPageSize}
                total={filteredLeaves.length}
                onPageChange={setLeavesPage}
                onPageSizeChange={(n) => { setLeavesPageSize(n); setLeavesPage(1) }}
              />
            )}
            {(isManagement || isRM) && (
              <div style={{ padding: '10px 16px', fontSize: 12, color: '#6b7280', borderTop: '1px solid #eef0f3', background: '#fafbfc', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Info size={13} style={{ flexShrink: 0 }} />
                {role === 'executive' || role === 'team-leader'
                  ? 'Management self-applications auto-complete the standard approval chain and route directly to the Master Admin for final verification.'
                  : isRM
                    ? `Your leave requests follow your approval chain: Reporting Manager (auto) → ${RM_CHAIN}. Pending tiers appear in the Approval column.`
                    : ''}
              </div>
            )}
          </div>
        )}

        {tab === 'attendance' && (
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eef0f3', fontSize: 13, fontWeight: 700, color: '#111827' }}>
              Attendance History · {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
            </div>
            {sortedRecords.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <Clock size={30} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.35 }} />
                <div style={{ fontSize: 14, color: '#9ca3af' }}>No attendance records this month yet.</div>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={TH_TEXT}>Date</th>
                      <th style={TH_TEXT}>Day</th>
                      <th style={TH_TEXT}>Check-In</th>
                      <th style={TH_TEXT}>Check-Out</th>
                      <th style={TH_TEXT}>Hours</th>
                      <th style={TH_TEXT}>Status</th>
                      <th style={TH_TEXT}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRecords.map((rec) => (
                      <tr key={rec.id}>
                        <td style={{ ...TD_TEXT, fontWeight: 600 }}>{fmtDate(rec.date)}</td>
                        <td style={{ ...TD_TEXT, color: '#6b7280' }}>{weekday(rec.date)}</td>
                        <td style={TD_TEXT}>{fmtTime(rec.checkIn)}</td>
                        <td style={TD_TEXT}>{fmtTime(rec.checkOut)}</td>
                        <td style={TD_TEXT}>{rec.workHours != null ? `${Number(rec.workHours).toFixed(1)}h` : '--'}</td>
                        <td style={TD_TEXT}>
                          <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: `${attendanceColor(rec.status)}12`, color: attendanceColor(rec.status) }}>
                            {rec.status}
                          </span>
                        </td>
                        <td style={TD_TEXT}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                            <button
                              onClick={() => setViewAttendance(rec)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                            >
                              <Eye size={14} /> View
                            </button>
                            {isActiveMissedPunchRecord(rec) ? (
                              windowClosed(rec.date) ? (
                                <span style={{ fontSize: 12, color: '#9ca3af', padding: '2px 2px', whiteSpace: 'nowrap' }}>Window closed</span>
                              ) : (
                                <button
                                  onClick={() => setRectifyModal(rec)}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 7, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                                >
                                  <Edit3 size={12} /> Rectify
                                </button>
                              )
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {sortedRecords.length > 0 && (
              <Pagination
                page={attendanceSafePage}
                pageSize={attendancePageSize}
                total={sortedRecords.length}
                onPageChange={setAttendancePage}
                onPageSizeChange={(n) => { setAttendancePageSize(n); setAttendancePage(1) }}
              />
            )}
          </div>
        )}

        {tab === 'missed' && (
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #eef0f3', fontSize: 13, fontWeight: 700, color: '#111827' }}>
              Missed Punches
            </div>
            {unresolvedMissPunches.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center' }}>
                <CheckCircle2 size={30} style={{ margin: '0 auto 10px', display: 'block', opacity: 0.35 }} />
                <div style={{ fontSize: 14, color: '#9ca3af' }}>No unresolved missed punches. You're all caught up.</div>
              </div>
            ) : (
              unresolvedMissPunches.map((rec) => {
                const requested = rec.missedPunchRectification?.requested
                const statusColor = requested ? '#d97706' : '#7c3aed'
                return (
                  <div
                    key={rec.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '13px 16px', borderBottom: '1px solid #f3f4f6',
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{fmtDate(rec.date)}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        {requested ? 'Rectification submitted · pending review' : `Checked in at ${fmtTime(rec.checkIn)} · check-out missing`}
                      </div>
                    </div>
                    {requested ? (
                      <button
                        onClick={() => setViewAttendance(rec)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 13px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                      >
                        <Eye size={14} /> View status
                      </button>
                    ) : windowClosed(rec.date) ? (
                        <span style={{ fontSize: 12, color: '#9ca3af' }}>Window closed</span>
                      ) : (
                        <button
                          onClick={() => setRectifyModal(rec)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 13px', borderRadius: 7, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                        >
                          <Edit3 size={12} /> Apply
                        </button>
                      )}
                  </div>
                )
              })
            )}
            {(isManagement || isRM) && (
              <div style={{ padding: '10px 16px', fontSize: 12, color: '#6b7280', borderTop: '1px solid #eef0f3', background: '#fafbfc', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Info size={13} style={{ flexShrink: 0 }} />
                {isRM
                  ? `Missed-punch corrections are routed through: ${MP_MISSED_PUNCH_CHAIN}.`
                  : 'Corrections here are routed through the approval pipeline and applied automatically once every relevant tier approves.'}
              </div>
            )}
          </div>
        )}
      </div>

      <LeaveApplyModal
        isOpen={showApplyLeave}
        onClose={() => { setShowApplyLeave(false); setResubmittingLeave(null) }}
        companyId={companyId || undefined}
        resubmitting={resubmittingLeave}
      />

      <Modal isOpen={!!rectifyModal} onClose={() => { setRectifyModal(null); setRectifyTime(''); setRectifyRemark('') }} title="Rectify Missed Punch" size="small">
        {rectifyModal && (
          <div style={{ padding: '8px 0' }}>
            <p style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>
              You missed your checkout on <strong>{fmtDate(rectifyModal.date)}</strong>.
            </p>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Checked in at {fmtTime(rectifyModal.checkIn)}. Enter your actual checkout time.
            </p>
            {(rectificationRoutedToMA || isRM) && (
              <div style={{ padding: '8px 12px', marginBottom: 12, borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', fontSize: 12, color: '#92400e', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Info size={13} />
                {rectificationRoutedToMA
                  ? 'This rectification will be routed to the Master Admin for review.'
                  : `This rectification will be routed through: ${MP_MISSED_PUNCH_CHAIN}.`}
              </div>
            )}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Correct Check-Out Time
              </label>
              <input
                type="time"
                value={rectifyTime}
                onChange={(e) => setRectifyTime(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, outline: 'none' }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Remark (Optional)
              </label>
              <textarea
                value={rectifyRemark}
                onChange={(e) => setRectifyRemark(e.target.value)}
                rows={2}
                placeholder="Add a note for the approver..."
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, outline: 'none', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setRectifyModal(null); setRectifyTime(''); setRectifyRemark('') }}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                Cancel
              </button>
              <button onClick={handleRectifyRequest} disabled={!rectifyTime || submittingRectify}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: !rectifyTime ? '#d1d5db' : '#7c3aed',
                  color: '#fff', cursor: !rectifyTime ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                {submittingRectify ? <Loader2 className="animate-spin" size={16} /> : null}
                Submit for Review
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!viewLeave} onClose={() => setViewLeave(null)} title={viewLeave ? `${viewLeave.leaveType || 'Leave'} Request` : ''} size="medium">
        {viewLeave && (
          <div style={{ padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{
                padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                background: `${leaveStatusColor(viewLeave.status)}12`, color: leaveStatusColor(viewLeave.status),
              }}>
                {viewLeave.status}
              </span>
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                {fmtDate(viewLeave.startDate)} – {fmtDate(viewLeave.endDate)} · {viewLeave.totalDays || 1} day{viewLeave.totalDays > 1 ? 's' : ''}
              </span>
              {!viewLeave.isPaid && <span style={{ fontSize: 12, color: '#9ca3af' }}>Unpaid</span>}
            </div>

            <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>
              <span style={{ color: '#9ca3af' }}>Reason: </span>{viewLeave.reason || '—'}
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 18 }}>
              Applied on {fmtDate(viewLeave.appliedOn)}{viewLeave.rejectedAt ? ` · Rejected on ${fmtDate(viewLeave.rejectedAt)}` : ''}
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>
              Approval Chain
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {getApprovalSteps(viewLeave).map((step, i) => (
                <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f0f2f5' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', minWidth: 130 }}>{step.label}</span>
                  {i < getApprovalSteps(viewLeave).length - 1 ? <ArrowRight size={11} style={{ color: '#cbd5e1' }} /> : null}
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: levelColor(step.status), flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: levelColor(step.status) }}>{step.status}</span>
                  {step.approvedByName && <span style={{ fontSize: 12, color: '#9ca3af' }}>by {step.approvedByName}</span>}
                  {step.note ? <span style={{ fontSize: 12, color: '#9ca3af' }}>· {step.note}</span> : null}
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 }}>
              Audit Log
            </div>
            {viewLeave.approvalLog?.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {viewLeave.approvalLog.map((entry, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6b7280' }}>
                    <span style={{ fontWeight: 600, color: entry.status === 'Approved' ? '#16a34a' : '#dc2626' }}>{entry.status}</span>
                    <span>{entry.approvedByName}</span>
                    <span style={{ color: '#9ca3af' }}>· {fmtDate(entry.approvedOn)}</span>
                    {entry.note ? <span style={{ color: '#9ca3af' }}>· “{entry.note}”</span> : null}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#9ca3af' }}>No approvals recorded yet.</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
              <button onClick={() => setViewLeave(null)}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!viewAttendance} onClose={() => setViewAttendance(null)} title="Attendance Details" size="medium">
        {viewAttendance && (() => {
          const mp = viewAttendance.missedPunchRectification
          const requested = !!mp?.requested
          const effective = getRecordEffectiveMissedPunchTiers(mp)
          const status = (mp?.approvalStatus || {}) as Record<ApprovalTier, string>
          const log = (mp?.approvalLog || []) as Array<{ tier: string; status: string; approvedBy: string; approvedByName: string; note?: string }>
          const maReq = !!mp?.masterAdminRequired
          const done = effective.filter(t => status[t] === 'Approved' || status[t] === 'Rejected').length
          const total = effective.length + (maReq ? 1 : 0)
          const chip = (s: string) => s === 'Approved' ? { bg: '#dcfce7', c: '#16a34a' } : s === 'Rejected' ? { bg: '#fee2e2', c: '#ef4444' } : { bg: '#fef3c7', c: '#b45309' }
          return (
            <div style={{ padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: '#111827' }}>{fmtDate(viewAttendance.date)}</span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>{weekday(viewAttendance.date)}</span>
                <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: `${attendanceColor(viewAttendance.status)}12`, color: attendanceColor(viewAttendance.status) }}>
                  {viewAttendance.status}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
                <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f0f2f5' }}>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>Check-In</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{fmtTime(viewAttendance.checkIn)}</div>
                </div>
                <div style={{ padding: '10px 12px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f0f2f5' }}>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>Check-Out</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{fmtTime(viewAttendance.checkOut)}</div>
                </div>
              </div>
              {viewAttendance.workHours != null && (
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
                  Worked <strong>{Number(viewAttendance.workHours).toFixed(1)} hours</strong>
                </div>
              )}
              {requested && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                    Rectification Approval Chain
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                    Corrected check-out: <strong>{fmtTime(mp.correctedCheckOut)}</strong> · Progress <strong>{Math.min(done, total)}</strong>/{total} step{total > 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {effective.map(t => {
                      const st = status[t] || 'Pending'
                      const c = chip(st)
                      return (
                        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f0f2f5' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', minWidth: 130 }}>{MISSED_PUNCH_TIER_LABELS[t as keyof typeof MISSED_PUNCH_TIER_LABELS]}</span>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.c, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: c.c }}>{st}</span>
                        </div>
                      )
                    })}
                    {maReq && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: '#f9fafb', border: '1px solid #f0f2f5' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', minWidth: 130 }}>Master Admin</span>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: chip(mp.masterAdminApproveStatus || 'Pending').c, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: chip(mp.masterAdminApproveStatus || 'Pending').c }}>{mp.masterAdminApproveStatus || 'Pending'}</span>
                      </div>
                    )}
                  </div>
                  {log.length > 0 && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                        Audit Log
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                        {log.map((entry, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6b7280' }}>
                            <span style={{ fontWeight: 600, color: entry.status === 'Approved' ? '#16a34a' : '#dc2626' }}>{entry.status}</span>
                            <span>{entry.approvedByName}</span>
                            {entry.note ? <span style={{ color: '#9ca3af' }}>· “{entry.note}”</span> : null}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {mp?.remark && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                      Your remark: “{mp.remark}”
                    </div>
                  )}
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                <button onClick={() => setViewAttendance(null)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                  Close
                </button>
              </div>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}