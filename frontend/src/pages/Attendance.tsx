import { useState, useEffect, useCallback, useRef } from 'react'
import { errText } from '../aws/errors';
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Clock, CheckCircle, XCircle, Search, Loader2, User, LogIn, LogOut, Filter, Building2, ThumbsUp, ThumbsDown, Ban, AlertCircle, RefreshCw, ChevronLeft, ChevronRight, Activity, Edit3, MapPin, Wifi, Shield, Camera, Globe, Smartphone, Crown, Eye, QrCode } from 'lucide-react'
import { collection, query, where, onSnapshot, orderBy } from '../aws/firestore-compat'
import { db } from '../aws/clients'
import { Header } from '../components/Header'
import { Modal } from '../components/Modal'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAccessControl } from '../context/AccessControlContext'
import { ScopeIndicator } from '../components/ScopeIndicator'
import { useContingencyAccess } from '../hooks/useContingencyAccess'
import { checkIn, checkOut, approveAttendance, updateAttendance, requestPunchRectification, detectMissedPunches, resolvePunchRectification, reviewMissedPunchTier, reviewMasterAdminMissedPunch, editMissedPunch, MISSED_PUNCH_TIER_LABELS, getNextPendingMissedPunchTier, isAwaitingMissedPunchMasterAdmin, getRecordEffectiveMissedPunchTiers } from '../services/attendanceService'
import { getAttendancePolicy } from '../services/attendanceSettingsService'
import { logAttendanceEvent } from '../services/attendanceLogService'
import { getCurrentPosition, isWithinRadius } from '../utils/geoUtils'
import { getNetworkInfo, getDeviceId } from '../utils/networkUtils'
import { isDate } from '../utils/dateUtils'
import { isActiveMissedPunchRecord } from '../utils/attendanceStatus'
import { matchesAttendanceSearch } from '../utils/attendanceSearch'
import { scopedCompanyIds, companyIdWhere, chunkCompanyIds } from '../utils/companyScope'
import { notifyTlAction } from '../services/notificationService'
import { notifyAttendanceCascade } from '../services/attendanceNotifier'
import { logAudit } from '../services/auditLogService'
import { getAllEmployees, getEmployeeByUserId } from '../services/employeeService'
import type { AttendanceRecord, Employee, ApprovalTier } from '../types/user'
import type { AttendancePolicy } from '../types/attendance'
import './Dashboard.css'

const statusStyle = (status: string) => {
  switch (status) {
    case 'Approved': return { bg: '#dcfce7', text: '#16a34a', icon: CheckCircle }
    case 'Present': return { bg: '#dcfce7', text: '#16a34a', icon: CheckCircle }
    case 'Absent': return { bg: '#fee2e2', text: '#ef4444', icon: XCircle }
    case 'Late': return { bg: '#fef3c7', text: '#f59e0b', icon: AlertCircle }
    case 'On Leave': return { bg: '#eff6ff', text: '#2563eb', icon: Clock }
    case 'Miss Punch': return { bg: '#f3e8ff', text: '#9333ea', icon: AlertCircle }
    default: return { bg: '#f3f4f6', text: '#6b7280', icon: Clock }
  }
}

const formatTime = (d: Date | null | undefined) => {
  if (!d) return '--:--'
  const date = (d as any)?.toDate ? (d as any).toDate() : isDate(d) ? d : new Date(d)
  if (isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

const formatDate = (d: Date | null | undefined) => {
  if (!d) return ''
  const date = (d as any)?.toDate ? (d as any).toDate() : isDate(d) ? d : new Date(d)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

const MA_MISSED_PUNCH_LABEL = 'Master Admin'

const missedPunchTierLabel = (tier: string) =>
  MISSED_PUNCH_TIER_LABELS[tier as ApprovalTier] || (tier === 'masterAdmin' ? MA_MISSED_PUNCH_LABEL : tier)

const isMissedPunchMasterAdminPending = (r: AttendanceRecord) => {
  const mp = r.missedPunchRectification
  if (!mp?.requested || !mp?.approvalStatus) return false
  return !!mp.masterAdminRequired
    && (mp.masterAdminApproveStatus == null || mp.masterAdminApproveStatus === 'Pending')
    && getRecordEffectiveMissedPunchTiers(mp).every(t => mp.approvalStatus?.[t] === 'Approved')
}

export function Attendance() {
  const { user, hasPermission } = useAuth()
  const { effectiveCompanyId, availableCompanies, selectedCompanyName, isLoading: companyLoading } = usePermissionScope('attendance')
  const { isScopeReady, isViewOnly, canPerform, scopeCompanyId } = useAccessControl()
  const navigate = useNavigate()
  const role: string = (user?.role || 'employee') as string
  const isEmployee = role === 'employee'
  const isCompanyAdmin = role === 'company-admin'
  const isMasterAdmin = role === 'master-admin'
  const companyId = isMasterAdmin ? null : effectiveCompanyId

  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'All')

  // Sync status filter when navigated with ?status= (e.g. dashboard card clicks)
  useEffect(() => {
    const s = searchParams.get('status')
    if (s) setStatusFilter(s)
  }, [searchParams])
  const [companyFilter, setCompanyFilter] = useState('All')
  const [companies, setCompanies] = useState<{ id: string; name: string; slug?: string }[]>([])
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [hierarchyUsers, setHierarchyUsers] = useState<any[]>([])
  const [executiveFilter, setExecutiveFilter] = useState('All')
  const [tlFilter, setTLFilter] = useState('All')
  const [employeeData, setEmployeeData] = useState<Employee | null>(null)
const [rectifyModal, setRectifyModal] = useState<AttendanceRecord | null>(null)
  const [viewModal, setViewModal] = useState<AttendanceRecord | null>(null)
const [rectifyTime, setRectifyTime] = useState('')
  const [rectifyRemark, setRectifyRemark] = useState('')
const [submittingRectify, setSubmittingRectify] = useState(false)
  const [rectifyTierAction, setRectifyTierAction] = useState<ApprovalTier | null>(null)
  const [rectifyMasterAdmin, setRectifyMasterAdmin] = useState(false)
  const [missPunchModal, setMissPunchModal] = useState<AttendanceRecord | null>(null)
  const [missPunchRemark, setMissPunchRemark] = useState('')
  const [submittingMissPunch, setSubmittingMissPunch] = useState(false)
  const [missedPunchRecords, setMissedPunchRecords] = useState<AttendanceRecord[]>([])
  const [attendancePolicy, setAttendancePolicy] = useState<AttendancePolicy | null>(null)
  const [gpsStatus, setGpsStatus] = useState<{ lat: number; lon: number } | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [isGpsLoading, setIsGpsLoading] = useState(false)
  const [deviceId] = useState(getDeviceId)
  const [networkInfo, setNetworkInfo] = useState(getNetworkInfo())
  const [selfieImage, setSelfieImage] = useState<string | null>(null)
  // Branch QR code for check-in (company policy `enableQr`).
  const [qrInput, setQrInput] = useState('')
  const [showSelfieCamera, setShowSelfieCamera] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const isAdmin = isCompanyAdmin || isMasterAdmin
  const isTeamLeader = role === 'team-leader'
  const isExecutive = role === 'executive'
  const isReportingManager = role === 'reporting-manager' || role === 'hr-manager'
  const canCheckInOut = isEmployee || isReportingManager || isExecutive || isTeamLeader || isMasterAdmin
  const showOrgColumns = isMasterAdmin || isExecutive || isTeamLeader
  const contingency = useContingencyAccess()
  const canManage = isMasterAdmin || isCompanyAdmin || isExecutive || isReportingManager || isTeamLeader
  const actingContext = contingency.isContingencyActive && contingency.actingForExecutive
    ? ` (Acting for Executive ${contingency.actingForExecutive.name})`
    : ''

  const executives = hierarchyUsers.filter(u => u.role === 'executive' && u.isActive !== false)
  const teamLeaders = hierarchyUsers.filter(u => u.role === 'team-leader' && u.isActive !== false)
  // Org-filter dropdown options: master-admin sees every company / executive /
  // team-leader; an executive or team-leader only sees those inside their own
  // scoped companies (availableCompanies), so the filters narrow their existing
  // access and never widen it.
  const scopeIdSet = isMasterAdmin ? null : new Set(availableCompanies.map((c: any) => c.id))
  const filterExecutives = scopeIdSet
    ? executives.filter((e: any) => (e.assignedCompanyIds || []).some((id: string) => scopeIdSet.has(id)))
    : executives
  const filterTeamLeaders = scopeIdSet
    ? teamLeaders.filter((tl: any) => {
        const linked: string[] = tl.linkedExecutiveIds || (tl.reportingExecutiveId ? [tl.reportingExecutiveId] : [])
        return linked.some((exId: string) => filterExecutives.some((e: any) => e.id === exId))
      })
    : teamLeaders
  const filterCompanies = isMasterAdmin ? companies : availableCompanies
  const getCompanyName = (cId: string) => {
    if (!cId) return '--'
    if (companies.length === 0) return cId
    const byId = companies.find(c => c.id === cId)
    if (byId) return byId.name
    const legacy = companies.find(c => c.name === cId || (c.slug && c.slug === cId))
    return legacy ? legacy.name : cId
  }
  const getExecForCompany = (cId: string) => executives.find((e: any) => (e.assignedCompanyIds || []).includes(cId))
  const getTLForExec = (execId: string) => teamLeaders.find((tl: any) => {
    const linkedIds = tl.linkedExecutiveIds || (tl.reportingExecutiveId ? [tl.reportingExecutiveId] : [])
    return linkedIds.includes(execId)
  })

  // Which missed-punch tier can the current user act on for a given record?
  // The user may approve only the next Pending tier AND only if they are the
  // assigned approver for that tier (strict sequential chain, same company).
  const getMyMissedPunchTier = (r: AttendanceRecord): ApprovalTier | null => {
    const mp = r.missedPunchRectification
    if (!mp?.requested || !mp?.approvalStatus) return null
    const next = getNextPendingMissedPunchTier(mp.approvalStatus)
    if (!next) return null
    const approverId = mp.approverIds?.[next]
    // Contingency: a TL acting for an executive may step in for the exec tier.
    if (next === 'executive' && contingency.isContingencyActive && contingency.actingForExecutive) return next
    if (approverId === user?.id) return next
    // Legacy fallback mirroring the leave chain: when the pending tier carries
    // no stamped approver (docs created before authoritative approverIds were
    // resolved, or an RM id stored as the manager's employee-document-id), grant
    // the natural role holder of the tier the Approve/Reject control instead of
    // hiding the actions entirely.
    if (approverId) return null
    if (!scopedCompanyIds(companyId, availableCompanies).includes(r.companyId)) return null
    if ((role === 'reporting-manager' || role === 'hr-manager') && next === 'reportingManager') return next
    if (role === 'hr' && next === 'hr') return next
    if (role === 'company-admin' && next === 'companyAdmin') return next
    if (role === 'executive' && next === 'executive') return next
    if (role === 'team-leader' && next === 'teamLeader') return next
    return null
  }

  const missedPunchProgress = (r: AttendanceRecord): number => {
    const mp = r.missedPunchRectification
    if (!mp?.approvalStatus) return 0
    // Progress over only the applicant's effective verification steps plus the
    // Master Admin final gate: Employee = 4 (RM → CA → Exec → TL),
    // Reporting Manager / HR = 3, Executive = TL + Master Admin (2),
    // Team Leader = Master Admin (1).
    const tiers = getRecordEffectiveMissedPunchTiers(mp)
    const tierDone = tiers.filter(t => mp.approvalStatus?.[t] === 'Approved' || mp.approvalStatus?.[t] === 'Rejected').length
    const maDone = mp.masterAdminRequired && (mp.masterAdminApproveStatus === 'Approved' || mp.masterAdminApproveStatus === 'Rejected')
    return tierDone + (maDone ? 1 : 0)
  }

  // Role-aware modal header. Counts exactly the verification steps rendered as
  // chips inside the modal (effective tiers + Master Admin gate) so the title
  // never mislabels the chain: Employee = 4-Tier (RM → CA → Exec → TL),
  // RM/HR = 3-Tier (CA → Exec → TL), Executive = 2-Tier (TL → Master Admin),
  // Team Leader = 1-Tier (Master Admin direct).
  const missedPunchModalTitle = (r: AttendanceRecord | null): string => {
    const mp = r?.missedPunchRectification
    const tiers = getRecordEffectiveMissedPunchTiers(mp)
    const labels = tiers.map(t => MISSED_PUNCH_TIER_LABELS[t])
    if (mp?.masterAdminRequired) labels.push(MA_MISSED_PUNCH_LABEL)
    if (labels.length === 0) return 'Missed Punch — Verification'
    return `Missed Punch — ${labels.length}-Tier Verification (${labels.join(' → ')})`
  }

  useEffect(() => {
    if (!showOrgColumns || companyFilter === 'All') return
    setCurrentPage(1)
  }, [companyFilter])

  useEffect(() => {
    if (!showOrgColumns) return
    setCurrentPage(1)
  }, [executiveFilter, tlFilter])

  useEffect(() => {
    // Guard: wait for CompanyContext to be ready
    if (companyLoading) return
    // Restricted roles with zero authorized companies â†’ nothing to show
    const scopeIds = scopedCompanyIds(companyId, availableCompanies)
    if (!isEmployee && !isMasterAdmin && scopeIds.length === 0) {
      setLoading(false)
      setRecords([])
      return
    }
    // Employee (self-filtered) and master-admin (all companies) need no company constraint

    const applyMapped = (data: AttendanceRecord[]) => {
      setRecords(data.reverse())
      setLoading(false)
      setError(null)

      if (canCheckInOut && user?.id) {
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const todayEnd = new Date()
        todayEnd.setHours(23, 59, 59, 999)
        const today = data.find(r =>
          r.userId === user.id &&
          r.date >= todayStart &&
          r.date <= todayEnd
        )
        setTodayRecord(today || null)
      }
    }

    const applySnapshot = (snapshot: any) => {
      const data = snapshot.docs.map((d: any) => {
        const raw = d.data()
        return {
          id: d.id,
          ...raw,
          // Server-written records carry employeeName, web-written rows carry
          // name — normalise so every column/render site sees `name`.
          name: raw.name ?? raw.employeeName ?? '',
          date: raw.date?.toDate ? raw.date.toDate() : raw.date,
          checkIn: raw.checkIn?.toDate ? raw.checkIn.toDate() : raw.checkIn,
          checkOut: raw.checkOut?.toDate ? raw.checkOut.toDate() : raw.checkOut,
          approvedOn: raw.approvedOn?.toDate ? raw.approvedOn.toDate() : raw.approvedOn,
        } as AttendanceRecord
      })
      applyMapped(data)
    }

    const onErr = (err: any) => {
      console.error('[Attendance] onSnapshot error:', err?.message || err)
      if (err?.message?.includes('index')) {
        console.warn('Composite query unavailable — server-side index required.')
      }
      setLoading(false)
      setError('Failed to load attendance records. Retrying...')
      setTimeout(() => setError(null), 8000)
    }

    const unsubs: (() => void)[] = []

    if (isEmployee) {
      const constraints: any[] = [orderBy('date', 'asc'), where('userId', '==', user?.id)]
      unsubs.push(onSnapshot(query(collection(db, 'attendance'), ...constraints), applySnapshot, onErr))
    } else if (isTeamLeader && contingency.isContingencyActive && contingency.executiveCompanyIds.length > 0) {
      const ids = contingency.executiveCompanyIds.slice(0, 10)
      const constraints: any[] = [orderBy('date', 'asc')]
      if (ids.length === 1) constraints.push(where('companyId', '==', ids[0]))
      else constraints.push(where('companyId', 'in', ids))
      unsubs.push(onSnapshot(query(collection(db, 'attendance'), ...constraints), applySnapshot, onErr))
    }
    else if (isMasterAdmin) {
      unsubs.push(onSnapshot(query(collection(db, 'attendance'), orderBy('date', 'asc')), applySnapshot, onErr))
    }
    else {
      const mergedMap = new Map<string, AttendanceRecord>()
      for (const chunk of chunkCompanyIds(scopeIds)) {
        const constraints: any[] = [orderBy('date', 'asc'), companyIdWhere(chunk)!]
        const un = onSnapshot(query(collection(db, 'attendance'), ...constraints), (snapshot: any) => {
          snapshot.docs.forEach((d: any) => {
            const raw = d.data()
            mergedMap.set(d.id, {
              id: d.id,
              ...raw,
              name: raw.name ?? raw.employeeName ?? '',
              date: raw.date?.toDate ? raw.date.toDate() : raw.date,
              checkIn: raw.checkIn?.toDate ? raw.checkIn.toDate() : raw.checkIn,
              checkOut: raw.checkOut?.toDate ? raw.checkOut.toDate() : raw.checkOut,
              approvedOn: raw.approvedOn?.toDate ? raw.approvedOn.toDate() : raw.approvedOn,
            } as AttendanceRecord)
          })
          applyMapped([...mergedMap.values()])
        }, onErr)
        unsubs.push(un)
      }
    }

    return () => unsubs.forEach(u => u())
  }, [user?.id, isEmployee, companyId, isTeamLeader, contingency.isContingencyActive, contingency.executiveCompanyIds.join(','), companyLoading, availableCompanies])

  useEffect(() => {
    if (!showOrgColumns) return
    const unsub = onSnapshot(collection(db, 'companies'), (snapshot) => {
      setCompanies(snapshot.docs.map(d => ({ id: d.id, name: d.data().name || d.id, slug: d.data().slug })))
    }, (err) => {
      console.error('[Attendance] companies onSnapshot error:', err?.message || err);
    })
    return () => unsub()
  }, [showOrgColumns])

  useEffect(() => {
    if (!showOrgColumns) return
    const unsub = onSnapshot(query(collection(db, 'users'), where('role', 'in', ['executive', 'team-leader'])), (snapshot) => {
      setHierarchyUsers(snapshot.docs.map(d => ({ id: d.id, ...d.data() })))
    }, (err) => {
      console.error('[Attendance] hierarchy users onSnapshot error:', err?.message || err)
    })
    return () => unsub()
  }, [showOrgColumns])

  // Fetch employee shift data for check-in processing
  useEffect(() => {
    if (!canCheckInOut || !user?.id) return
    getEmployeeByUserId(user.id).then(emp => {
      setEmployeeData(emp)
    }).catch(() => {})
  }, [canCheckInOut, user?.id])

  // Load attendance policy for geo-fencing, network validation, etc.
  useEffect(() => {
    if (!companyId && !isMasterAdmin) return
    const cid = companyId || effectiveCompanyId || user?.companyId
    if (!cid) return
    getAttendancePolicy(cid).then(p => setAttendancePolicy(p)).catch(() => {})
  }, [companyId, isMasterAdmin, effectiveCompanyId, user?.companyId])

  // Get GPS position on mount (for employee check-in)
  useEffect(() => {
    if (!canCheckInOut) return
    setIsGpsLoading(true)
    getCurrentPosition(10000, 30000, true)
      .then(pos => {
        setGpsStatus({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setGpsError(null)
      })
      .catch(err => {
        setGpsError(errText(err, 'Unable to get GPS location'))
      })
      .finally(() => setIsGpsLoading(false))
  }, [isEmployee])

  // Refresh network info periodically
  useEffect(() => {
    if (!canCheckInOut) return
    const interval = setInterval(() => setNetworkInfo(getNetworkInfo()), 10000)
    return () => clearInterval(interval)
  }, [canCheckInOut])

  // Start/stop camera for selfie capture
  useEffect(() => {
    if (!showSelfieCamera) return
    let active = true
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } })
        if (active && videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch { /* camera access denied or unavailable */ }
    }
    start()
    return () => {
      active = false
      const stream = videoRef.current?.srcObject as MediaStream | null
      stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
    }
  }, [showSelfieCamera])

  // Detect missed punches on mount
  useEffect(() => {
    if (!canManage || !companyId) return
    const run = async () => {
      const missed = await detectMissedPunches(companyId)
      if (missed.length > 0) {
        setMissedPunchRecords(prev => [...prev, ...missed])
        setActionMsg({ type: 'success', text: `Detected ${missed.length} missed punch(es). Notifications sent.` })
      }
    }
    run()
    const interval = setInterval(run, 60000)
    return () => clearInterval(interval)
  }, [canManage, companyId])

  // Reporting Manager: resolve direct-report userIds so the view stays
  // exclusive to their own reporting line inside the company.
  const [teamUserIds, setTeamUserIds] = useState<string[]>([])
  useEffect(() => {
    if (!isReportingManager || !user?.id) { setTeamUserIds([]); return }
    const cid = companyId || effectiveCompanyId || user.companyId
    if (!cid) return
    const unsub = onSnapshot(query(collection(db, 'employees'), where('companyId', '==', cid)), (snap) => {
      const ids = snap.docs
        .filter(d => {
          const e: any = d.data()
          return e.managerId === user.id || e.reportingManagerId === user.id
        })
        .map(d => (d.data() as any).userId || d.id)
      setTeamUserIds(ids)
    }, () => setTeamUserIds([]))
    return () => unsub()
  }, [isReportingManager, user?.id, companyId, effectiveCompanyId])

  const visibleRecords = showOrgColumns && companyFilter !== 'All'
    ? records.filter(r => r.companyId === companyFilter)
    : isReportingManager && teamUserIds.length > 0
      ? records.filter(r => teamUserIds.includes(r.userId) || r.userId === user?.id)
      : records

  const todayOnly = searchParams.get('period') === 'today'
  const filtered = visibleRecords.filter(r => {
    // Server-written records carry employeeName (no name/department) — an
    // empty search must still match them (see utils/attendanceSearch.ts).
    const matchesSearch = matchesAttendanceSearch(r, searchTerm)
    const matchesStatus = statusFilter === 'All' || r.status === statusFilter
    const matchesPeriod = !todayOnly || (() => {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      return r.date >= start && r.date < end
    })()
    const matchesExec = !showOrgColumns || executiveFilter === 'All' || (() => {
      const exec = getExecForCompany(r.companyId)
      return exec && exec.id === executiveFilter
    })()
    const matchesTL = !showOrgColumns || tlFilter === 'All' || (() => {
      const exec = getExecForCompany(r.companyId)
      if (!exec) return false
      const tl = getTLForExec(exec.id)
      return tl && tl.id === tlFilter
    })()
    return matchesSearch && matchesStatus && matchesPeriod && matchesExec && matchesTL
  })

  const totalPages = Math.ceil(filtered.length / pageSize)
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const empStats = isEmployee ? [
    { label: 'Total', count: filtered.length, color: '#6b7280', filter: 'All' },
    { label: 'Approved', count: filtered.filter(r => r.status === 'Approved').length, color: '#16a34a', filter: 'Approved' },
    { label: 'Late', count: filtered.filter(r => r.status === 'Late').length, color: '#f97316', filter: 'Late' },
  ] : [
    { label: 'Total', count: filtered.length, color: '#6b7280', filter: 'All' },
    { label: 'Present', count: filtered.filter(r => r.status === 'Present').length, color: '#16a34a', filter: 'Present' },
    { label: 'Late', count: filtered.filter(r => r.status === 'Late').length, color: '#f59e0b', filter: 'Late' },
    { label: 'Absent', count: filtered.filter(r => r.status === 'Absent').length, color: '#ef4444', filter: 'Absent' },
    { label: 'Miss Punch', count: filtered.filter(r => r.status === 'Miss Punch').length, color: '#9333ea', filter: 'Miss Punch' },
  ]

  const handleCheckIn = async () => {
    if (!user || checkingIn) return
    setCheckingIn(true)
    setActionMsg(null)
    try {
      const cid = effectiveCompanyId || user.companyId || ''
      const policy = attendancePolicy

      // Try to get fresh GPS before check-in
      let lat = gpsStatus?.lat || null
      let lon = gpsStatus?.lon || null
      try {
        const pos = await getCurrentPosition(5000, 0, true)
        lat = pos.coords.latitude
        lon = pos.coords.longitude
        setGpsStatus({ lat, lon })
      } catch {}

      // Try cloud function first, fall back to direct Firestore
      try {
        const { httpsCallable } = await import('../aws/functions-compat')
        const { functions: fns } = await import('../aws/clients')
        const markAttendance = httpsCallable(fns, 'markAttendance')
        const netInfo = getNetworkInfo()
        const result = await markAttendance({
          action: 'check-in',
          companyId: cid,
          latitude: lat,
          longitude: lon,
          wifiSsid: netInfo.wifiSsid,
          networkType: netInfo.networkType,
          isVpn: netInfo.isVpn,
          isMockLocation: false,
          isEmulator: netInfo.isEmulator,
          deviceId,
          deviceModel: navigator.userAgent,
          batteryLevel: 0,
          // Branch context — the server verifies the employee's assignment and
          // the QR token against the branch record (nothing here is trusted).
          branchId: employeeData?.primaryBranchId || undefined,
          qrToken: qrInput.trim() || undefined,
        })
        const data = result.data as any
        setQrInput('')

        if (data.status === 'Late' || data.lateMinutes > 0) {
          await notifyAttendanceCascade({
            companyId: cid,
            employeeUserId: user.id,
            employeeName: user.name,
            kind: 'late-checkin',
            dateLabel: new Date().toLocaleDateString(),
            note: data.lateMinutes ? `${data.lateMinutes} min late.` : '',
            actorName: user.name,
          })
          setActionMsg({ type: 'success', text: `Checked in! You are ${data.lateMinutes} min late. Auto-approved.` })
        } else {
          setActionMsg({ type: 'success', text: data.message || 'Checked in successfully!' })
        }

        await logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: `Checked in via Smart Attendance (${data.status})`, actionType: 'create',
          module: 'Attendance', targetEntity: user.name, status: 'success',
        })
        return
      } catch (fnErr: any) {
        if (fnErr.code !== 'functions-not-found' && !fnErr.message?.includes('CORS') && !fnErr.message?.includes('not found') && fnErr.code !== 'unavailable') {
          throw fnErr
        }
        console.warn('[Attendance] Cloud function unavailable, using direct check-in:', fnErr.message)
      }

      // Direct Firestore fallback — enforce geofence client-side (the cloud
      // function does this server-side, but when it is unavailable we must still
      // respect the office geofence so employees cannot check in from anywhere).
      if (policy?.enableGeofence && lat && lon) {
        const loc = policy.officeLocation
        if (loc && loc.latitude && loc.longitude && loc.radiusMeters) {
          if (!isWithinRadius(lat, lon, loc.latitude, loc.longitude, loc.radiusMeters)) {
            setActionMsg({ type: 'error', text: 'You are outside the allowed geofence area for this office.' })
            setCheckingIn(false)
            return
          }
        }
      }
      // Enforce network (Wi-Fi / mobile data) rules client-side as well.
      if (policy?.enableNetworkGuard) {
        const netInfo = getNetworkInfo()
        if (policy.wifiOnly && netInfo.networkType !== 'wifi') {
          setActionMsg({ type: 'error', text: 'Only office Wi-Fi is allowed. Please connect to office Wi-Fi.' })
          setCheckingIn(false)
          return
        }
        if (policy.wifiOnly && netInfo.networkType === 'wifi' && policy.allowedWifis?.length > 0 && netInfo.wifiSsid) {
          const allowed = policy.allowedWifis.some((w: any) => w.ssid.toLowerCase() === netInfo.wifiSsid!.toLowerCase())
          if (!allowed) {
            setActionMsg({ type: 'error', text: 'Connected to a non-approved Wi-Fi network.' })
            setCheckingIn(false)
            return
          }
        }
        if (netInfo.networkType === 'mobile' && !policy.mobileDataAllowed) {
          setActionMsg({ type: 'error', text: 'Mobile data is not allowed. Please use office Wi-Fi.' })
          setCheckingIn(false)
          return
        }
      }
      const record = await checkIn({
        userId: user.id,
        companyId: cid,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        employeeId: user.id,
        department: '',
        departmentColor: '#f97316',
        employee: employeeData || undefined,
        latitude: lat || undefined,
        longitude: lon || undefined,
      })
      if (record.status === 'Late') {
        await notifyAttendanceCascade({
          companyId: record.companyId || cid,
          employeeUserId: user.id,
          employeeName: user.name,
          kind: 'late-checkin',
          dateLabel: new Date().toLocaleDateString(),
          note: record.lateMinutes ? `${record.lateMinutes} min late.` : '',
          actorName: user.name,
        })
        setActionMsg({ type: 'success', text: `Checked in! You are ${record.lateMinutes} min late. Auto-approved.` })
      } else if (record.status === 'On Leave') {
        setActionMsg({ type: 'success', text: 'You are on approved leave today. Marked as On Leave.' })
      } else if (isCompanyAdmin || isMasterAdmin) {
        await approveAttendance(record.id, user.id, user.name)
        setActionMsg({ type: 'success', text: 'Checked in successfully! Auto-approved.' })
      } else {
        setActionMsg({ type: 'success', text: 'Checked in successfully! Attendance is being processed.' })
      }
    } catch (err: any) {
      setActionMsg({ type: 'error', text: errText(err, 'Check-in failed') })
    } finally {
      setCheckingIn(false)
    }
  }

  const handleCheckOut = async () => {
    if (!todayRecord || checkingOut) return
    setCheckingOut(true)
    setActionMsg(null)
    try {
      const policy = attendancePolicy
      let lat = gpsStatus?.lat || null
      let lon = gpsStatus?.lon || null
      try {
        const pos = await getCurrentPosition(5000, 0, true)
        lat = pos.coords.latitude
        lon = pos.coords.longitude
        setGpsStatus({ lat, lon })
      } catch {}
      if (policy?.enableGeofence && lat && lon) {
        const loc = policy.officeLocation
        if (loc && loc.latitude && loc.longitude && loc.radiusMeters) {
          if (!isWithinRadius(lat, lon, loc.latitude, loc.longitude, loc.radiusMeters)) {
            setActionMsg({ type: 'error', text: 'You are outside the allowed geofence area. Please return to the office to check out.' })
            setCheckingOut(false)
            return
          }
        }
      }
      if (policy?.enableNetworkGuard) {
        const netInfo = getNetworkInfo()
        if (policy.wifiOnly && netInfo.networkType !== 'wifi') {
          setActionMsg({ type: 'error', text: 'Only office Wi-Fi is allowed for check-out. Please connect to office Wi-Fi.' })
          setCheckingOut(false)
          return
        }
        if (policy.wifiOnly && netInfo.networkType === 'wifi' && policy.allowedWifis?.length > 0 && netInfo.wifiSsid) {
          const allowed = policy.allowedWifis.some((w: any) => w.ssid.toLowerCase() === netInfo.wifiSsid!.toLowerCase())
          if (!allowed) {
            setActionMsg({ type: 'error', text: 'Connected to a non-approved Wi-Fi network.' })
            setCheckingOut(false)
            return
          }
        }
        if (netInfo.networkType === 'mobile' && !policy.mobileDataAllowed) {
          setActionMsg({ type: 'error', text: 'Mobile data is not allowed for check-out. Please use office Wi-Fi.' })
          setCheckingOut(false)
          return
        }
      }
      const updated = await checkOut(todayRecord.id)
      if (updated) setTodayRecord(updated)
      setActionMsg({ type: 'success', text: 'Checked out successfully! Your day is complete.' })
    } catch (err: any) {
      setActionMsg({ type: 'error', text: errText(err, 'Check-out failed') })
    } finally {
      setCheckingOut(false)
    }
  }

  const handleApprove = async (id: string, name: string, companyId?: string) => {
    if (!user) return
    try {
      await approveAttendance(id, user.id, user.name)
      if (user.role === 'team-leader' && companyId) {
        notifyTlAction(
          companyId, 'attendance_approved', 'Attendance Approved',
          `${user.name || 'Team Leader'} approved attendance for ${name}`,
          '/attendance', hierarchyUsers
        ).catch(() => {})
      }
      logAudit({
        userId: user.id, userName: user.name, userRole: user.role,
        action: `Approved attendance for ${name}${actingContext}`, actionType: 'approve',
        module: 'Attendance', targetEntity: name, status: 'success',
      })
      setActionMsg({ type: 'success', text: `Approved attendance for ${name}` })
    } catch (err: any) {
      logAudit({
        userId: user.id, userName: user.name, userRole: user.role,
        action: `Failed to approve attendance for ${name}${actingContext}`, actionType: 'approve',
        module: 'Attendance', targetEntity: name, status: 'failure',
      })
      setActionMsg({ type: 'error', text: errText(err, 'Approval failed') })
    }
  }

  const handleMarkMissPunch = async (id: string, name: string, companyId: string, userId: string) => {
    if (!user) return
    if (!missPunchRemark.trim()) {
      setActionMsg({ type: 'error', text: 'A remark is required before marking Miss Punch.' })
      return
    }
    setSubmittingMissPunch(true)
    try {
      await updateAttendance(id, {
        status: 'Miss Punch',
        missPunchRemark: missPunchRemark.trim(),
        missPunchMarkedBy: user.id,
        missPunchMarkedByName: user.name,
        missPunchMarkedAt: new Date(),
      } as any)
      // Cascade to the employee + full same-company chain (RM, Company Admin,
      // assigned Executive, linked Team Leader, Master Admins) server-side.
      await notifyAttendanceCascade({
        companyId,
        employeeUserId: userId,
        employeeName: name,
        kind: 'missed-punch-marked',
        dateLabel: new Date().toLocaleDateString(),
        note: missPunchRemark.trim(),
        actorName: user.name,
      })
      logAudit({
        userId: user.id, userName: user.name, userRole: user.role,
        action: `Marked attendance for ${name} as Miss Punch${actingContext}`, actionType: 'update',
        module: 'Attendance', targetEntity: name, status: 'success',
      })
      setActionMsg({ type: 'success', text: `Marked ${name} as Miss Punch — notifications sent.` })
      setMissPunchModal(null)
      setMissPunchRemark('')
    } catch (err: any) {
      setActionMsg({ type: 'error', text: errText(err, 'Failed to mark Miss Punch') })
    } finally {
      setSubmittingMissPunch(false)
    }
  }

  const handleRectifyRequest = async () => {
    if (!rectifyModal || !rectifyTime || !user) return
    setSubmittingRectify(true)
    try {
      const [h, m] = rectifyTime.split(':').map(Number)
      const corrected = new Date(rectifyModal.date)
      corrected.setHours(h, m, 0, 0)
      await requestPunchRectification(rectifyModal.id, corrected, rectifyRemark)
      // Cascade the rectification request to the employee + full same-company
      // management chain (RM, Company Admin, assigned Executive, linked TL,
      // Master Admin) server-side.
      await notifyAttendanceCascade({
        companyId: rectifyModal.companyId,
        employeeUserId: user.id,
        employeeName: user.name,
        kind: 'rectification-requested',
        dateLabel: new Date(rectifyModal.date).toLocaleDateString(),
        note: rectifyRemark,
        actorName: user.name,
      })
      logAudit({
        userId: user.id, userName: user.name, userRole: user.role,
        action: `Requested missed punch rectification for ${rectifyModal.date?.toLocaleDateString()}`,
        actionType: 'update', module: 'Attendance', targetEntity: rectifyModal.name, status: 'success',
      })
      setActionMsg({ type: 'success', text: 'Rectification request submitted for manager review.' })
      setRectifyModal(null)
      setRectifyTime('')
      setRectifyRemark('')
    } catch (err: any) {
      setActionMsg({ type: 'error', text: errText(err, 'Failed to submit rectification') })
    } finally {
      setSubmittingRectify(false)
     }
  }

  const handleResolveRectification = async () => {
    if (!rectifyModal || !rectifyTime || submittingRectify) return
    if (!rectifyRemark.trim()) {
      setActionMsg({ type: 'error', text: 'A remark is required to resolve this rectification.' })
      return
    }
    try {
      await resolvePunchRectification(rectifyModal.id, user?.id || '', user?.name || '', 'approve', rectifyRemark)
      // Cascade the resolution to the employee + full same-company management
      // chain (RM, Company Admin, assigned Executive, linked TL, Master Admin).
      if (rectifyModal.userId) {
        await notifyAttendanceCascade({
          companyId: rectifyModal.companyId || effectiveCompanyId || '',
          employeeUserId: rectifyModal.userId,
          employeeName: rectifyModal.name || '',
          kind: 'rectification-resolved',
          dateLabel: new Date(rectifyModal.date).toLocaleDateString(),
          note: rectifyRemark,
          actorName: user?.name || 'Manager',
        })
      }
      setRectifyModal(null)
      setRectifyTime('')
      setRectifyRemark('')
      setSubmittingRectify(false)
      setActionMsg({ type: 'success', text: 'Rectification resolved.' })
      logAudit({
        userId: user?.id || '', userName: user?.name || '', userRole: user?.role || '',
        action: 'Resolved punch rectification', actionType: 'update', module: 'Attendance',
        targetEntity: rectifyModal?.name || '', status: 'success',
      })
    } catch (err: any) {
      setActionMsg({ type: 'error', text: errText(err, 'Failed to resolve rectification') })
    } finally {
      setSubmittingRectify(false)
    }
  }

  const handleReviewMissedPunchTier = async (action: 'Approved' | 'Rejected', tier: ApprovalTier | null = rectifyTierAction) => {
    if (!rectifyModal || !tier || submittingRectify) return
    if (!rectifyRemark.trim()) {
      setActionMsg({ type: 'error', text: 'A mandatory remark is required to review this missed punch.' })
      return
    }
    setSubmittingRectify(true)
    try {
      // If the reviewer edited the Correct Check-Out Time, persist the edit so
      // the final applied punch matches what the chain verified.
      if (rectifyTime) {
        const [h, m] = rectifyTime.split(':').map(Number)
        const currentCorrected = rectifyModal.missedPunchRectification?.correctedCheckOut
          ? new Date(rectifyModal.missedPunchRectification.correctedCheckOut)
          : null
        const edited = new Date(rectifyModal.date)
        edited.setHours(h, m, 0, 0)
        const changed = !currentCorrected || (currentCorrected.getHours() !== edited.getHours() || currentCorrected.getMinutes() !== edited.getMinutes())
        if (changed) {
          await editMissedPunch(
            rectifyModal.id,
            edited,
            rectifyRemark,
            user?.id || '',
            user?.name || '',
          )
        }
      }
      await reviewMissedPunchTier(
        rectifyModal.id,
        tier,
        action,
        user?.id || '',
        user?.name || '',
        rectifyRemark
      )
      if (rectifyModal?.userId && rectifyModal?.companyId) {
        await notifyAttendanceCascade({
          companyId: rectifyModal.companyId,
          employeeUserId: rectifyModal.userId,
          employeeName: rectifyModal.name || '',
          kind: 'rectification-resolved',
          dateLabel: new Date(rectifyModal.date).toLocaleDateString(),
          note: rectifyRemark,
          actorName: user?.name || 'Manager',
        })
      }
      setActionMsg({
        type: 'success',
        text: action === 'Approved'
          ? `Verified as ${MISSED_PUNCH_TIER_LABELS[tier]}.`
          : `Rejected at the ${MISSED_PUNCH_TIER_LABELS[tier]} level.`,
      })
      setRectifyModal(null)
      setRectifyTime('')
      setRectifyRemark('')
      setRectifyTierAction(null)
      logAudit({
        userId: user?.id || '', userName: user?.name || '', userRole: user?.role || '',
        action: `${action === 'Approved' ? 'Verified' : 'Rejected'} missed punch as ${MISSED_PUNCH_TIER_LABELS[tier]} for ${rectifyModal?.name || ''}`,
        actionType: 'update', module: 'Attendance', targetEntity: rectifyModal?.name || '', status: 'success',
      })
    } catch (err: any) {
      setActionMsg({ type: 'error', text: errText(err, 'Failed to review missed punch') })
    } finally {
      setSubmittingRectify(false)
    }
  }

  const handleReviewMasterAdminMissedPunch = async (action: 'Approved' | 'Rejected') => {
    if (!rectifyModal || submittingRectify) return
    if (!rectifyRemark.trim()) {
      setActionMsg({ type: 'error', text: 'A mandatory remark is required for Master Admin review.' })
      return
    }
    setSubmittingRectify(true)
    try {
      await reviewMasterAdminMissedPunch(
        rectifyModal.id,
        action,
        user?.id || '',
        user?.name || '',
        rectifyRemark
      )
      setActionMsg({
        type: 'success',
        text: action === 'Approved'
          ? 'Missed punch finalized as approved by Master Admin.'
          : 'Missed punch rejected by Master Admin.',
      })
      setRectifyModal(null)
      setRectifyTime('')
      setRectifyRemark('')
      setRectifyTierAction(null)
      setRectifyMasterAdmin(false)
      logAudit({
        userId: user?.id || '', userName: user?.name || '', userRole: user?.role || '',
        action: `${action === 'Approved' ? 'Finalized' : 'Rejected'} missed punch as Master Admin for ${rectifyModal?.name || ''}`,
        actionType: 'update', module: 'Attendance', targetEntity: rectifyModal?.name || '', status: 'success',
      })
    } catch (err: any) {
      setActionMsg({ type: 'error', text: errText(err, 'Failed to review missed punch') })
    } finally {
      setSubmittingRectify(false)
    }
  }

  if (loading) {
    return (
      <div className="page-container">
        <Header title="Attendance" />
        <div className="page-content">
          <div className="loading-container"><Loader2 className="animate-spin" size={32} /><p>Loading attendance...</p></div>
        </div>
      </div>
    )
  }

  return (
    <div className="page-container">
      <Header title={isEmployee ? 'My Attendance' : isMasterAdmin ? 'Master Attendance' : 'Attendance Management'} />
      <div className="page-content">

        {error && (
          <div style={{
            padding: '12px 16px', borderRadius: 10, marginBottom: 16,
            background: '#fff3cd', color: '#856404',
            fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8
          }}>
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {actionMsg && (
          <div style={{
            padding: '12px 16px', borderRadius: 10, marginBottom: 16,
            background: actionMsg.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: actionMsg.type === 'success' ? '#16a34a' : '#ef4444',
            fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8
          }}>
            {actionMsg.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
            {actionMsg.text}
            <button onClick={() => setActionMsg(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}>&times;</button>
          </div>
        )}

        <ScopeIndicator />

        {isTeamLeader && contingency.isContingencyActive && contingency.actingForExecutive && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px', marginBottom: 16,
            borderRadius: 10, border: '1px solid #f97316',
            background: 'linear-gradient(135deg, #fff7ed, #ffedd5)',
            fontSize: 13, color: '#9a3412'
          }}>
            <Activity size={18} style={{ color: '#f97316', flexShrink: 0 }} />
            <div>
              <strong style={{ fontWeight: 600 }}>Acting Manager — </strong>
              You are performing operations in place of <strong>{contingency.actingForExecutive.name}</strong>.
              All actions will be logged with this context.
            </div>
          </div>
        )}
        {canCheckInOut && isEmployee && (
          <div style={{
            background: 'linear-gradient(135deg, #f97316, #ea580c)', borderRadius: 16,
            padding: 24, marginBottom: 24, color: '#fff'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
                  {todayRecord ? (todayRecord.checkOut ? 'Day Complete' : 'Checked In') : 'Start Your Day'}
                </h2>
                <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: 14 }}>
                  {todayRecord
                    ? todayRecord.checkOut
                      ? `Checked out at ${formatTime(todayRecord.checkOut)} Â· ${todayRecord.workHours?.toFixed(1)}h worked`
                      : `Checked in at ${formatTime(todayRecord.checkIn)} Â· awaiting check-out`
                    : 'Mark your attendance for today'}
                </p>
                {employeeData?.shiftStart && employeeData?.shiftEnd && (
                  <p style={{ margin: '2px 0 0', opacity: 0.7, fontSize: 12 }}>
                    Shift: {employeeData.shiftStart} - {employeeData.shiftEnd} ({employeeData.shiftType || 'Morning'})
                  </p>
                )}
                {todayRecord?.status === 'Late' && (
                  <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: 13 }}>
                    <AlertCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                    {todayRecord.lateMinutes} min late Â· Auto-approved
                  </p>
                )}
                {todayRecord?.isAutoApproved && todayRecord.checkOut && (
                  <p style={{ margin: '4px 0 0', opacity: 0.75, fontSize: 13 }}>
                    <CheckCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                    Auto-Approved
                  </p>
                )}
                {todayRecord?.status === 'Approved' && (
                  <p style={{ margin: '4px 0 0', opacity: 0.75, fontSize: 13 }}>
                    <CheckCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                    Approved by {todayRecord.approvedByName || 'System'}
                  </p>
                )}
                {todayRecord && isActiveMissedPunchRecord(todayRecord) && (
                  <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: 13 }}>
                    <AlertCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                    Missed checkout — <button onClick={() => setRectifyModal(todayRecord)} style={{ background: 'none', border: 'none', color: '#fff', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 13 }}>
                      Rectify now
                    </button>
                  </p>
                )}
                {/* GPS & Network Status */}
                {!todayRecord?.checkIn && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {gpsStatus ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.15)', fontSize: 11 }}>
                        <MapPin size={11} /> GPS Locked
                      </span>
                    ) : isGpsLoading ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.15)', fontSize: 11 }}>
                        <Loader2 className="animate-spin" size={11} /> GPS Loading...
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.15)', fontSize: 11 }}>
                        <MapPin size={11} /> GPS Unavailable
                      </span>
                    )}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.15)', fontSize: 11 }}>
                      <Wifi size={11} /> {networkInfo.networkType || 'unknown'}
                    </span>
                    {attendancePolicy?.enableGeofence && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.15)', fontSize: 11 }}>
                        <Globe size={11} /> Geofence {attendancePolicy.mode.replace(/-/g, ' ')}
                      </span>
                    )}
                  </div>
                )}
              </div>
              {!todayRecord?.checkIn && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {attendancePolicy?.enableQr && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <QrCode size={16} style={{ opacity: 0.7 }} />
                      <input
                        value={qrInput}
                        onChange={(e) => setQrInput(e.target.value)}
                        placeholder="Scan or enter branch QR code"
                        aria-label="Branch QR code"
                        style={{
                          flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.4)',
                          background: 'rgba(255,255,255,0.95)', fontSize: 13, color: '#111827', minWidth: 0,
                        }}
                      />
                    </div>
                  )}
                  {attendancePolicy?.enableSelfie && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Camera size={16} style={{ opacity: 0.7 }} />
                      {selfieImage ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <img src={selfieImage} alt="Selfie" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }} />
                          <span style={{ fontSize: 11, color: '#fff' }}><CheckCircle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 2 }} /> Captured</span>
                          <button onClick={() => { setSelfieImage(null); setShowSelfieCamera(true) }}
                            style={{ background: 'none', border: 'none', color: '#fff', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0 }}>Retake</button>
                        </div>
                      ) : (
                        <button onClick={() => setShowSelfieCamera(true)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 6, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', fontSize: 12 }}>
                          <Camera size={14} /> Capture Selfie
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                {(!todayRecord || !todayRecord.checkIn) && (
                  <button onClick={handleCheckIn}
                    disabled={checkingIn || Boolean(attendancePolicy?.enableQr && !qrInput.trim())}
                    title={attendancePolicy?.enableQr && !qrInput.trim() ? 'Enter the branch QR code first' : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '12px 28px',
                      borderRadius: 12, border: 'none', background: 'rgba(255,255,255,0.2)',
                      color: '#fff', fontSize: 16, fontWeight: 600,
                      cursor: checkingIn || (attendancePolicy?.enableQr && !qrInput.trim()) ? 'not-allowed' : 'pointer',
                      opacity: attendancePolicy?.enableQr && !qrInput.trim() ? 0.6 : 1,
                      backdropFilter: 'blur(4px)'
                    }}>
                    {checkingIn ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
                    Check In
                  </button>
                )}
                {todayRecord?.checkIn && !todayRecord.checkOut && (
                  <button onClick={handleCheckOut} disabled={checkingOut}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '12px 28px',
                      borderRadius: 12, border: 'none', background: '#fff',
                      color: '#ea580c', fontSize: 16, fontWeight: 600, cursor: checkingOut ? 'not-allowed' : 'pointer'
                    }}>
                    {checkingOut ? <Loader2 className="animate-spin" size={20} /> : <LogOut size={20} />}
                    Check Out
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <Modal isOpen={showSelfieCamera} onClose={() => { setShowSelfieCamera(false); }} title="Capture Selfie" size="small">
          <div style={{ padding: '8px 0' }}>
            <video ref={videoRef} autoPlay playsInline style={{ width: '100%', borderRadius: 8, background: '#000', maxHeight: 300 }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button onClick={() => {
                const video = videoRef.current
                const canvas = canvasRef.current
                if (!video || !canvas) return
                canvas.width = video.videoWidth
                canvas.height = video.videoHeight
                const ctx = canvas.getContext('2d')
                if (!ctx) return
                ctx.drawImage(video, 0, 0)
                setSelfieImage(canvas.toDataURL('image/jpeg', 0.8))
                setShowSelfieCamera(false)
                ;(video.srcObject as MediaStream)?.getTracks().forEach((t: MediaStreamTrack) => t.stop())
              }}
                style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                <Camera size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} /> Capture
              </button>
              <button onClick={() => { setShowSelfieCamera(false); (videoRef.current?.srcObject as MediaStream)?.getTracks().forEach((t: MediaStreamTrack) => t.stop()) }}
                style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>

        <div className="stats-grid" style={{ marginBottom: 24 }}>
          {empStats.map((s, i) => (
            <div
              key={i}
              className="stat-card"
              onClick={() => setStatusFilter(prev => prev === s.filter ? 'All' : s.filter)}
              style={{
                cursor: 'pointer',
                border: statusFilter === s.filter ? `2px solid ${s.color}` : '2px solid transparent',
                boxShadow: statusFilter === s.filter ? `0 0 0 3px ${s.color}25` : 'none',
                transition: 'all 0.15s ease'
              }}
            >
              <div className="stat-icon"><Clock size={24} style={{ color: s.color }} /></div>
              <div className="stat-info">
                <span className="stat-label">{s.label}</span>
                <div className="stat-value">{s.count}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#6b7280' }} />
            <input
              type="text"
              placeholder={isEmployee ? "Search your records..." : "Search by name or department..."}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px 10px 36px', borderRadius: 8,
                border: '1px solid #e5e7eb', background: '#fff', fontSize: 14, outline: 'none'
              }}
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{
              padding: '10px 36px 10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
              background: '#fff', fontSize: 14, outline: 'none', appearance: 'none',
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 5L6 8L9 5' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center'
            }}
          >
            <option value="All">All Status</option>
            <option value="Approved">Approved</option>
            <option value="Present">Present</option>
            <option value="Late">Late</option>
            <option value="Miss Punch">Miss Punch</option>
            <option value="On Leave">On Leave</option>
            <option value="Absent">Absent</option>
          </select>
          {showOrgColumns && (
            <select
              value={companyFilter}
              onChange={e => setCompanyFilter(e.target.value)}
              style={{
                padding: '10px 36px 10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                background: '#fff', fontSize: 14, outline: 'none', appearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 5L6 8L9 5' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center'
              }}
            >
              <option value="All">All Companies</option>
              {filterCompanies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {showOrgColumns && (
            <select
              value={executiveFilter}
              onChange={e => setExecutiveFilter(e.target.value)}
              style={{
                padding: '10px 36px 10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                background: '#fff', fontSize: 14, outline: 'none', appearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 5L6 8L9 5' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center'
              }}
            >
              <option value="All">All Executives</option>
              {filterExecutives.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          {showOrgColumns && (
            <select
              value={tlFilter}
              onChange={e => setTLFilter(e.target.value)}
              style={{
                padding: '10px 36px 10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                background: '#fff', fontSize: 14, outline: 'none', appearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' viewBox='0 0 12 12' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M3 5L6 8L9 5' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center'
              }}
            >
              <option value="All">All Team Leaders</option>
              {filterTeamLeaders.map(tl => <option key={tl.id} value={tl.id}>{tl.name}</option>)}
            </select>
          )}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}>
              <User size={32} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <p>No attendance records found{selectedCompanyName ? ` for ${selectedCompanyName}` : ''}</p>
            </div>
          ) : (
            <>
              <div className="table-scroll" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                      <th style={isEmployee ? thStyle : thLeft}>{isEmployee ? 'Date' : 'Employee'}</th>
                      {!isEmployee && <th style={thStyle}>Department</th>}
                      {showOrgColumns && <th style={thStyle}>Company</th>}
                      {showOrgColumns && <th style={thStyle}>Executive</th>}
                      {showOrgColumns && <th style={thStyle}>Team Leader</th>}
                      <th style={thStyle}>Date</th>
                      <th style={thStyle}>Check In</th>
                      <th style={thStyle}>Check Out</th>
                      <th style={thStyle}>Shift</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Hours</th>
                      {isEmployee && <th style={thStyle}>Actions</th>}
                      {(canManage) && <th style={{ ...thStyle, width: 200 }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map(r => {
                      const sc = statusStyle(r.status)
                      const StatusIcon = sc.icon
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={isEmployee ? tdStyle : tdLeft}>
                            {isEmployee ? (
                              <span style={{ fontWeight: 500 }}>{formatDate(r.date)}</span>
                            ) : (
                              <span style={{ fontWeight: 500 }}>{r.name}</span>
                            )}
                          </td>
                          {!isEmployee && <td style={tdStyle}>{r.department || '--'}</td>}
                          {showOrgColumns && (() => {
                            const cName = getCompanyName(r.companyId)
                            return (
                              <td style={tdStyle}>
                                <span className="hierarchy-tag" title={cName}>{cName}</span>
                              </td>
                            )
                          })()}
                          {showOrgColumns && (() => {
                            const exec = getExecForCompany(r.companyId)
                            const eName = exec?.name || '--'
                            return (
                              <td style={tdStyle}>
                                <span className="hierarchy-tag" title={eName}>{eName}</span>
                              </td>
                            )
                          })()}
                          {showOrgColumns && (() => {
                            const exec = getExecForCompany(r.companyId)
                            const tl = exec ? getTLForExec(exec.id) : null
                            const tlName = tl?.name || '--'
                            const execInactive = exec && exec.isActive === false
                            return (
                              <td style={tdStyle}>
                                <span className="hierarchy-tag" title={tlName} style={{ position: 'relative' }}>
                                  {tlName}
                                </span>
                                {execInactive && tl && (
                                  <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 2,
                                    marginLeft: 4, padding: '1px 6px', borderRadius: 4,
                                    fontSize: 10, fontWeight: 600,
                                    background: '#fff7ed', color: '#f97316', border: '1px solid #fed7aa',
                                    verticalAlign: 'middle'
                                  }}>
                                    <Activity size={9} /> Acting
                                  </span>
                                )}
                              </td>
                            )
                          })()}
                          <td style={tdStyle}>{formatDate(r.date)}</td>
                          <td style={tdStyle}>{formatTime(r.checkIn)}</td>
                          <td style={tdStyle}>{formatTime(r.checkOut)}</td>
                          <td style={tdStyle}>
                            {r.shiftStart && r.shiftEnd ? (
                              <span style={{ fontSize: 12, color: '#6b7280' }}>{r.shiftStart}-{r.shiftEnd}</span>
                            ) : <span style={{ fontSize: 12, color: '#d1d5db' }}>--</span>}
                          </td>
                          <td style={tdStyle}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                              padding: '3px 10px', borderRadius: 6,
                              fontSize: 12, fontWeight: 500, background: sc.bg, color: sc.text
                            }}>
                              <StatusIcon size={12} />
                              {r.status}
                            </span>
                          </td>
                          <td style={tdStyle}>{r.workHours ? `${r.workHours.toFixed(1)}h` : '--'}</td>
                          {isEmployee && (
                            <td style={tdStyle}>
                              <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <button onClick={() => setViewModal(r)} title="View attendance & approval details"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', color: '#374151', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                                  <Eye size={13} /> View
                                </button>
                                {isActiveMissedPunchRecord(r) ? (
                                  <button onClick={() => setRectifyModal(r)}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                                      borderRadius: 6, border: 'none', background: '#f3e8ff',
                                      color: '#9333ea', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                                    }}>
                                    <Edit3 size={14} /> Rectify
                                  </button>
                                ) : r.missedPunchRectification?.resolved ? (
                                  <span style={{ fontSize: 12, color: '#16a34a' }}>Rectified</span>
                                ) : null}
                              </div>
                            </td>
                          )}
                          {canManage && (
                            <td style={tdStyle}>
                              <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <button onClick={() => setViewModal(r)} title="View record details"
                                  style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 6px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', color: '#6b7280', fontSize: 12, cursor: 'pointer' }}>
                                  <Eye size={14} />
                                </button>
                                {contingency.isContingencyActive && contingency.actingForExecutive && (
                                  <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px',
                                    borderRadius: 4, fontSize: 10, fontWeight: 600,
                                    background: '#fff7ed', color: '#f97316', border: '1px solid #fed7aa',
                                    marginRight: 4
                                  }}>
                                    <Activity size={10} /> Acting
                                  </span>
                                )}
                                {r.status !== 'Approved' && r.status !== 'On Leave' && (
                                  <>
                                    {r.missedPunchRectification?.requested && (() => {
                                      const myT = getMyMissedPunchTier(r)
                                      const mpStatus = r.missedPunchRectification?.status || (r.missedPunchRectification?.resolved ? 'Approved' : 'Pending')
                                      const maPending = isMissedPunchMasterAdminPending(r)
                                      if (maPending && isMasterAdmin) {
                                        return (
                                          <button onClick={() => {
                                            setRectifyModal(r)
                                            const co = r.missedPunchRectification?.correctedCheckOut
                                            if (co) {
                                              const d = (co as any)?.toDate ? (co as any).toDate() : new Date(co)
                                              setRectifyTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
                                            } else {
                                              setRectifyTime('')
                                            }
                                            setRectifyRemark('')
                                            setRectifyTierAction(null)
                                            setRectifyMasterAdmin(true)
                                          }}
                                            style={{
                                              display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                                              borderRadius: 6, border: 'none', background: '#c2410c',
                                              color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                                            }}>
                                            <Crown size={14} />
                                            Master Admin Review
                                          </button>
                                        )
                                      }
                                      if (mpStatus !== 'Pending') return null
                                      return (
                                        <button onClick={() => {
                                          setRectifyModal(r)
                                          const co = r.missedPunchRectification?.correctedCheckOut
                                          if (co) {
                                            const d = (co as any)?.toDate ? (co as any).toDate() : new Date(co)
                                            setRectifyTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
                                          } else {
                                            setRectifyTime('')
                                          }
                                          setRectifyRemark('')
                                          setRectifyTierAction(myT)
                                          setRectifyMasterAdmin(false)
                                        }}
                                          style={{
                                            display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                                            borderRadius: 6, border: 'none', background: myT ? '#9333ea' : '#f3e8ff',
                                            color: myT ? '#fff' : '#9333ea', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                                          }}>
                                          <Shield size={14} />
                                          {myT ? `Review (${MISSED_PUNCH_TIER_LABELS[myT].split(' ')[0]})` : 'Review'}
                                        </button>
                                      )
                                    })()}
                                    {(r.status === 'Present' || r.status === 'Late' || r.status === 'Absent') && canPerform('manage', 'attendance') && (
                                      <button onClick={() => handleApprove(r.id, r.name, r.companyId)}
                                        style={{
                                          display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                                          borderRadius: 6, border: 'none', background: '#dcfce7',
                                          color: '#16a34a', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                                        }}>
                                        <ThumbsUp size={14} /> Approve
                                      </button>
                                    )}
                                    {canPerform('manage', 'attendance') && r.checkIn && !r.checkOut && r.status !== 'Miss Punch' && (
                                      <button onClick={() => { setMissPunchModal(r); setMissPunchRemark('') }}
                                        style={{
                                          display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                                          borderRadius: 6, border: 'none', background: '#f3e8ff',
                                          color: '#9333ea', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                                        }}>
                                        <AlertCircle size={14} /> Miss Punch
                                      </button>
                                    )}
                                  </>
                                )}
                                {r.status === 'Approved' && (
                                  <span style={{ fontSize: 12, color: '#9ca3af' }}>
                                    by {r.approvedByName || 'Admin'}
                                  </span>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderTop: '1px solid #e5e7eb', fontSize: 13, color: '#6b7280'
              }}>
                <span>Showing {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1 }}>
                    <ChevronLeft size={16} />
                  </button>
                  <span>{currentPage} / {totalPages || 1}</span>
                  <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', opacity: currentPage >= totalPages ? 0.5 : 1 }}>
                    <ChevronRight size={16} />
                  </button>
                  <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13 }}>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        {canCheckInOut && !isAdmin && !isExecutive && !isTeamLeader && (
          <div style={{ marginTop: 20, padding: 16, background: '#fff7ed', borderRadius: 10, border: '1px solid #fed7aa', textAlign: 'center' }}>
            <p style={{ color: '#9a3412', fontSize: 14 }}>
              Only your own attendance records are shown. Contact your Company Admin for any corrections.
            </p>
          </div>
        )}
        {(isExecutive || isTeamLeader) && (
          <div style={{ marginTop: 20, padding: 16, background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe', textAlign: 'center' }}>
            <p style={{ color: '#1e40af', fontSize: 14 }}>
              You are viewing attendance for your assigned companies. Use the Company, Executive and Team Leader filters to narrow it.
            </p>
          </div>
        )}
      </div>

      {/* Missed Punch Rectification Modal */}
      <Modal isOpen={!!rectifyModal} onClose={() => { setRectifyModal(null); setRectifyTime(''); setRectifyRemark(''); setRectifyTierAction(null); setRectifyMasterAdmin(false) }} title={missedPunchModalTitle(rectifyModal)} size="small">
        {rectifyModal && (() => {
          const mp = rectifyModal.missedPunchRectification
          const requested = mp?.requested
          const myTier = requested ? getMyMissedPunchTier(rectifyModal) : null
          const overall = mp?.status || (mp?.resolved ? 'Approved' : 'Pending')
          const progress = missedPunchProgress(rectifyModal)
          // Effective tier count for display: role-aware chain plus the Master
          // Admin gate. Employee = 4 (RM → CA → Exec → TL), RM/HR = 3 (CA → Exec → TL),
          // Executive = TL + MA (2, direct routing),
          // Team Leader = MA only (1, direct routing).
          const mpCnTiers = getRecordEffectiveMissedPunchTiers(mp)
          const mpTotalTiers = mpCnTiers.length + (mp?.masterAdminRequired ? 1 : 0)
          const tierChip = (t: ApprovalTier) => {
            const st = mp?.approvalStatus?.[t] || 'Pending'
            const isMine = myTier === t
            const conf: Record<string, { bg: string; text: string }> = {
              Approved: { bg: '#dcfce7', text: '#16a34a' },
              Rejected: { bg: '#fee2e2', text: '#ef4444' },
              Pending: { bg: '#fef3c7', text: '#b45309' },
            }
            const c = conf[st] || conf.Pending
            return (
              <div key={t} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
                background: c.bg, color: c.text, fontSize: 11, fontWeight: 600,
                border: isMine ? '2px solid #9333ea' : '1px solid transparent'
              }}>
                {MISSED_PUNCH_TIER_LABELS[t]}
                <span>{st}{isMine ? ' (You)' : ''}</span>
              </div>
            )
          }
          return (
            <div style={{ padding: '8px 0' }}>
              <p style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>
                {isEmployee ? 'You missed your checkout on' : `${rectifyModal.name} missed checkout on`} <strong>{formatDate(rectifyModal.date)}</strong>.
              </p>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                Checked in at {formatTime(rectifyModal.checkIn)}.
                {isEmployee ? ' Please enter your actual checkout time.' : ' Please review and verify.'}
              </p>

              {requested && (
                <div style={{ marginBottom: 16, padding: '12px', background: '#faf5ff', borderRadius: 10, border: '1px solid #e9d5ff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#6b21a8' }}>Verification Progress</label>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#6b21a8' }}>{Math.min(progress, mpTotalTiers)}/{mpTotalTiers}</span>
                  </div>
                  <div style={{ height: 6, background: '#e9d5ff', borderRadius: 3, marginBottom: 10, overflow: 'hidden' }}>
                    <div style={{
                      width: `${(Math.min(progress, mpTotalTiers) / mpTotalTiers) * 100}%`,
                      height: '100%', background: overall === 'Rejected' ? '#ef4444' : '#9333ea', borderRadius: 3,
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {mpCnTiers.map(tierChip)}
                    {mp?.masterAdminRequired && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8,
                        background: mp.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : mp.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed',
                        color: mp.masterAdminApproveStatus === 'Approved' ? '#16a34a' : mp.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412',
                        fontSize: 11, fontWeight: 600, border: '1px solid transparent'
                      }}>
                        <Crown size={12} />
                        {MA_MISSED_PUNCH_LABEL}: {mp.masterAdminApproveStatus || 'Pending'}
                      </div>
                    )}
                  </div>
                  {overall === 'Approved' && (
                    <p style={{ marginTop: 8, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>Approved by all verification steps{(() => {
                      const mpRole = mp?.applicantRole
                      return mpRole === 'executive' ? ' (Team Leader & Master Admin)' : mpRole === 'team-leader' ? ' (Master Admin)' : ''
                    })()}. Attendance has been updated.</p>
                  )}
                  {overall === 'Rejected' && (
                    <p style={{ marginTop: 8, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>Rejected during verification.</p>
                  )}
                  {overall === 'Pending' && mp?.masterAdminRequired && (mp.masterAdminApproveStatus == null || mp.masterAdminApproveStatus === 'Pending') && getRecordEffectiveMissedPunchTiers(mp).every(t => mp.approvalStatus?.[t] === 'Approved') && !isEmployee && (
                    <p style={{ marginTop: 8, fontSize: 12, color: '#9a3412', fontWeight: 600 }}>
                      Awaiting {MA_MISSED_PUNCH_LABEL} final verification.
                    </p>
                  )}
                  {overall === 'Pending' && myTier && (
                    <p style={{ marginTop: 8, fontSize: 12, color: '#6b21a8', fontWeight: 600 }}>
                      Action required: {MISSED_PUNCH_TIER_LABELS[myTier]}. Add a mandatory remark below to approve or reject.
                    </p>
                  )}
                  {overall === 'Pending' && !myTier && !isEmployee && (
                    <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                      Awaiting the next tier in the verification chain.
                    </p>
                  )}
                </div>
              )}

              {mp?.approvalLog && mp.approvalLog.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid #e9d5ff', paddingTop: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#6b21a8', marginBottom: 6, display: 'block' }}>Audit Log</label>
                  {mp.approvalLog.map((entry: any, idx: number) => (
                    <div key={idx} style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: entry.status === 'Approved' ? '#dcfce7' : '#fee2e2', color: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }}>
                        {entry.status === 'Approved' ? '✓' : '✗'}
                      </span>
                      <span><strong>{missedPunchTierLabel(entry.tier)}</strong> by {entry.approvedByName}</span>
                      {entry.note && <span style={{ fontStyle: 'italic' }}>({entry.note})</span>}
                    </div>
                  ))}
                </div>
              )}

              {rectifyModal.missedPunchRectification?.employeeRemark && (
                <div style={{ marginBottom: 16, padding: '10px 12px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a' }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>Employee's Remark</label>
                  <p style={{ fontSize: 13, color: '#78350f', margin: 0 }}>{rectifyModal.missedPunchRectification.employeeRemark}</p>
                </div>
              )}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                  Correct Check-Out Time
                </label>
                <input
                  type="time"
                  value={rectifyTime}
                  onChange={e => setRectifyTime(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                    fontSize: 14, outline: 'none'
                  }}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                  {isEmployee ? 'Reason for Missed Checkout' : 'Remark/Routing Note'} <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <textarea
                  value={rectifyRemark}
                  onChange={e => setRectifyRemark(e.target.value)}
                  placeholder={
                    !requested
                      ? (isEmployee ? 'Explain why you missed checkout...' : 'Add a note...')
                      : (myTier ? 'Provide a mandatory remark for your verification decision...' : '')
                  }
                  rows={3}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                    fontSize: 14, outline: 'none', resize: 'vertical'
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button onClick={() => { setRectifyModal(null); setRectifyTime(''); setRectifyRemark(''); setRectifyTierAction(null); setRectifyMasterAdmin(false) }}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                  Cancel
                </button>
                {rectifyMasterAdmin ? (
                  <>
                    <button onClick={() => handleReviewMasterAdminMissedPunch('Approved')}
                      disabled={!rectifyRemark.trim() || submittingRectify}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', borderRadius: 8, border: 'none',
                        background: !rectifyRemark.trim() ? '#d1d5db' : '#16a34a',
                        color: '#fff', cursor: !rectifyRemark.trim() ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600
                      }}>
                      {submittingRectify ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
                      Approve as Master Admin
                    </button>
                    <button onClick={() => handleReviewMasterAdminMissedPunch('Rejected')}
                      disabled={!rectifyRemark.trim() || submittingRectify}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', borderRadius: 8, border: 'none',
                        background: !rectifyRemark.trim() ? '#d1d5db' : '#ef4444',
                        color: '#fff', cursor: !rectifyRemark.trim() ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600
                      }}>
                      {submittingRectify ? <Loader2 className="animate-spin" size={16} /> : <XCircle size={16} />}
                      Reject
                    </button>
                  </>
                ) : isEmployee ? (
                  <button onClick={handleRectifyRequest} disabled={!rectifyTime || !rectifyRemark.trim() || submittingRectify}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none',
                      background: (!rectifyTime || !rectifyRemark.trim()) ? '#d1d5db' : '#9333ea',
                      color: '#fff', cursor: (!rectifyTime || !rectifyRemark.trim()) ? 'not-allowed' : 'pointer',
                      fontSize: 14, fontWeight: 600,
                      display: 'flex', alignItems: 'center', gap: 6
                    }}>
                    {submittingRectify ? <Loader2 className="animate-spin" size={16} /> : null}
                    Submit for Verification
                  </button>
                ) : requested ? (
                  myTier ? (
                    <>
                      <button onClick={() => { setRectifyTierAction(myTier); handleReviewMissedPunchTier('Approved', myTier) }}
                        disabled={!rectifyRemark.trim() || submittingRectify}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', borderRadius: 8, border: 'none',
                          background: !rectifyRemark.trim() ? '#d1d5db' : '#16a34a',
                          color: '#fff', cursor: !rectifyRemark.trim() ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600
                        }}>
                        {submittingRectify ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
                        Approve as {MISSED_PUNCH_TIER_LABELS[myTier]}
                      </button>
                      <button onClick={() => { setRectifyTierAction(myTier); handleReviewMissedPunchTier('Rejected', myTier) }}
                        disabled={!rectifyRemark.trim() || submittingRectify}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', borderRadius: 8, border: 'none',
                          background: !rectifyRemark.trim() ? '#d1d5db' : '#ef4444',
                          color: '#fff', cursor: !rectifyRemark.trim() ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600
                        }}>
                        {submittingRectify ? <Loader2 className="animate-spin" size={16} /> : <XCircle size={16} />}
                        Reject
                      </button>
                    </>
                  ) : (
                    <button disabled
                      style={{
                        padding: '8px 16px', borderRadius: 8, border: 'none', background: '#e5e7eb',
                        color: '#6b7280', fontSize: 14, fontWeight: 600, cursor: 'not-allowed'
                      }}>
                      Awaiting Next Tier
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => { setRectifyTierAction(null); handleResolveRectification() }}
                    disabled={!rectifyTime || !rectifyRemark.trim() || submittingRectify}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4, padding: '8px 16px', borderRadius: 8, border: 'none',
                      background: (!rectifyTime || !rectifyRemark.trim()) ? '#d1d5db' : '#9333ea',
                      color: '#fff', cursor: (!rectifyTime || !rectifyRemark.trim()) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600
                    }}>
                    {submittingRectify ? <Loader2 className="animate-spin" size={16} /> : <Edit3 size={16} />}
                    Save & Resolve
                  </button>
                )}
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* View-only Attendance & Approval Details Modal */}
      <Modal isOpen={!!viewModal} onClose={() => setViewModal(null)} title="Attendance & Approval Details" size="small">
        {viewModal && (() => {
          const vm = viewModal.missedPunchRectification
          const hasChain = vm?.requested && vm?.approvalStatus
          const progress = hasChain ? missedPunchProgress(viewModal) : 0
          const mpCnTiers = hasChain ? getRecordEffectiveMissedPunchTiers(vm) : []
          const mpTotalTiers = mpCnTiers.length + (vm?.masterAdminRequired ? 1 : 0)
          const overall = vm?.status || (vm?.resolved ? 'Approved' : 'Pending')
          return (
            <div style={{ padding: '8px 0' }}>
              <p style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>
                <strong>{viewModal.name}</strong> — <strong>{formatDate(viewModal.date)}</strong>
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{
                  padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  background: `${statusStyle(viewModal.status).bg}`, color: statusStyle(viewModal.status).text
                }}>{viewModal.status}</span>
                <span style={{ fontSize: 13, color: '#6b7280' }}>
                  In {formatTime(viewModal.checkIn)} · Out {formatTime(viewModal.checkOut)} · {viewModal.workHours ? `${viewModal.workHours.toFixed(1)}h` : '--'}
                </span>
              </div>
              {hasChain && (
                <div style={{ marginBottom: 16, padding: 12, background: '#faf5ff', borderRadius: 10, border: '1px solid #e9d5ff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#6b21a8' }}>Verification Progress</label>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#6b21a8' }}>{Math.min(progress, mpTotalTiers)}/{mpTotalTiers}</span>
                  </div>
                  <div style={{ height: 6, background: '#e9d5ff', borderRadius: 3, marginBottom: 10, overflow: 'hidden' }}>
                    <div style={{
                      width: `${(Math.min(progress, mpTotalTiers) / mpTotalTiers) * 100}%`,
                      height: '100%', background: overall === 'Rejected' ? '#ef4444' : '#9333ea', borderRadius: 3, transition: 'width 0.3s ease'
                    }} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {mpCnTiers.map(t => {
                      const st = vm?.approvalStatus?.[t] || 'Pending'
                      const conf: Record<string, { bg: string; text: string }> = {
                        Approved: { bg: '#dcfce7', text: '#16a34a' },
                        Rejected: { bg: '#fee2e2', text: '#ef4444' },
                        Pending: { bg: '#fef3c7', text: '#b45309' },
                      }
                      const c = conf[st] || conf.Pending
                      return (
                        <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: c.bg, color: c.text, fontSize: 11, fontWeight: 600 }}>
                          {MISSED_PUNCH_TIER_LABELS[t]}: {st}
                        </div>
                      )
                    })}
                    {vm?.masterAdminRequired && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, background: vm.masterAdminApproveStatus === 'Approved' ? '#dcfce7' : vm.masterAdminApproveStatus === 'Rejected' ? '#fee2e2' : '#fff7ed', color: vm.masterAdminApproveStatus === 'Approved' ? '#16a34a' : vm.masterAdminApproveStatus === 'Rejected' ? '#ef4444' : '#9a3412', fontSize: 11, fontWeight: 600 }}>
                        <Crown size={12} /> {MA_MISSED_PUNCH_LABEL}: {vm.masterAdminApproveStatus || 'Pending'}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {vm?.employeeRemark && (
                <div style={{ marginBottom: 12, padding: 10, background: '#fffbeb', borderRadius: 8, border: '1px solid #fde68a', fontSize: 13, color: '#78350f' }}>
                  <strong>Employee Remark:</strong> {vm.employeeRemark}
                </div>
              )}
              {vm?.approvalLog && vm.approvalLog.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Audit Log</p>
                  {vm.approvalLog.map((entry: any, idx: number) => (
                    <div key={idx} style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: entry.status === 'Approved' ? '#dcfce7' : '#fee2e2', color: entry.status === 'Approved' ? '#16a34a' : '#ef4444' }}>
                        {entry.status === 'Approved' ? '✓' : '✗'}
                      </span>
                      <span><strong>{missedPunchTierLabel(entry.tier)}</strong> by {entry.approvedByName}</span>
                      {entry.note && <span style={{ fontStyle: 'italic' }}>({entry.note})</span>}
                    </div>
                  ))}
                </div>
              )}
              {!hasChain && (
                <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>No verification chain active for this record.</p>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button onClick={() => setViewModal(null)}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                  Close
                </button>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Miss Punch Mark Modal (mandatory remark by RM/TL/Exec/Admin) */}
      <Modal isOpen={!!missPunchModal} onClose={() => { setMissPunchModal(null); setMissPunchRemark('') }} title="Mark Miss Punch" size="small">
        {missPunchModal && (
          <div style={{ padding: '8px 0' }}>
            <p style={{ fontSize: 14, color: '#374151', marginBottom: 4 }}>
              Mark <strong>{missPunchModal.name}</strong> as Miss Punch?
            </p>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Employee checked in at {formatTime(missPunchModal.checkIn)} but has not checked out. A remark is required.
            </p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Remark <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <textarea
                value={missPunchRemark}
                onChange={e => setMissPunchRemark(e.target.value)}
                placeholder="Provide a mandatory remark (why this punch is being marked as missed)..."
                rows={3}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
                  fontSize: 14, outline: 'none', resize: 'vertical'
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setMissPunchModal(null); setMissPunchRemark('') }}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 14 }}>
                Cancel
              </button>
              <button onClick={() => handleMarkMissPunch(missPunchModal.id, missPunchModal.name, missPunchModal.companyId, missPunchModal.userId)}
                disabled={!missPunchRemark.trim() || submittingMissPunch}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: !missPunchRemark.trim() ? '#d1d5db' : '#9333ea',
                  color: '#fff', cursor: !missPunchRemark.trim() ? 'not-allowed' : 'pointer',
                  fontSize: 14, fontWeight: 600
                }}>
                {submittingMissPunch ? <Loader2 className="animate-spin" size={16} /> : null}
                Mark Miss Punch
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: '12px 16px', textAlign: 'center', verticalAlign: 'middle',
  fontSize: 12, fontWeight: 600, lineHeight: 1.4,
  color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
  borderBottom: '1px solid #e5e7eb'
}

const thLeft: React.CSSProperties = { ...thStyle, textAlign: 'left' }

const thRight: React.CSSProperties = { ...thStyle, textAlign: 'right' }

const tdStyle: React.CSSProperties = {
  padding: '12px 16px', fontSize: 14, color: '#374151',
  whiteSpace: 'nowrap', verticalAlign: 'middle', textAlign: 'center', lineHeight: 1.4,
  borderBottom: '1px solid #f3f4f6'
}

const tdLeft: React.CSSProperties = { ...tdStyle, textAlign: 'left' }

const tdRight: React.CSSProperties = { ...tdStyle, textAlign: 'right' }
