import { useCallback, useEffect, useState } from 'react'
import { invalidateSnapshots } from 'firebase/firestore'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { useEmployeePersonalStats } from './useEmployeePersonalStats'
import { checkIn, checkOut, approveAttendance } from '../services/attendanceService'
import { getAttendancePolicy } from '../services/attendanceSettingsService'
import { getCurrentPosition, isWithinRadius } from '../utils/geoUtils'
import { getNetworkInfo, getDeviceId } from '../utils/networkUtils'
import { notifyAttendanceCascade } from '../services/attendanceNotifier'
import { logAudit } from '../services/auditLogService'
import { getEmployeeByUserId } from '../services/employeeService'
import type { AttendancePolicy } from '../types/attendance'
import type { Employee } from '../types/user'

export interface PunchMsg {
  type: 'success' | 'error'
  text: string
}

/**
 * Standalone check-in / check-out logic used by every personal attendance
 * view (My Attendance page, dashboard My Attendance cards, role portals).
 *
 * Mirrors the employee flow on the Attendance page:
 *  - live `todayRecord` from `useEmployeePersonalStats` (onSnapshot) so the
 *    banner, widgets and table logs refresh instantly after a punch,
 *  - cloud function first with a direct-Firestore fallback for transport
 *    failures (function unavailable / CORS / deadline), while genuine
 *    business errors (already checked in / already checked out) hard-fail so
 *    duplicate punches are never created,
 *  - client-side geofence + network-guard enforcement on the fallback path,
 *  - auto-approve + audit for admin applicants (master-admin / company-admin),
 *  - late check-in cascades notifications.
 */
export function useAttendancePunch() {
  const { user } = useAuth()
  const { effectiveCompanyId } = useCompany()
  const personal = useEmployeePersonalStats()
  const [attendancePolicy, setAttendancePolicy] = useState<AttendancePolicy | null>(null)
  const [employeeData, setEmployeeData] = useState<Employee | null>(null)
  const [gpsStatus, setGpsStatus] = useState<{ lat: number; lon: number } | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [isGpsLoading, setIsGpsLoading] = useState(true)
  const [networkInfo, setNetworkInfo] = useState(getNetworkInfo())
  const [checkingIn, setCheckingIn] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [msg, setMsg] = useState<PunchMsg | null>(null)

  const todayRecord = personal.todayRecord
  const companyId = effectiveCompanyId || user?.companyId || ''
  const role = user?.role || 'employee'
  const isMasterAdmin = role === 'master-admin'
  const isCompanyAdmin = role === 'company-admin'
  const deviceId = getDeviceId()

  // Company attendance policy (geofence / network guard / late config).
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    getAttendancePolicy(companyId)
      .then((p) => { if (!cancelled) setAttendancePolicy(p) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [companyId])

  // Employee shift metadata (also resolves the company for master-admins).
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    getEmployeeByUserId(user.id)
      .then((emp) => { if (!cancelled) setEmployeeData(emp) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user?.id])

  // Initial GPS fix for check-in readiness.
  useEffect(() => {
    getCurrentPosition(10000, 30000, true)
      .then((pos) => {
        setGpsStatus({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setGpsError(null)
      })
      .catch((err: unknown) => {
        setGpsError(err instanceof Error ? err.message : 'Unable to get GPS location')
      })
      .finally(() => setIsGpsLoading(false))
  }, [])

  // Refresh network info periodically.
  useEffect(() => {
    const interval = window.setInterval(() => setNetworkInfo(getNetworkInfo()), 10000)
    return () => window.clearInterval(interval)
  }, [])

  /**
   * Client-side policy check used on the direct-Firestore fallback path.
   * Returns an error message when the punch is not allowed, otherwise null.
   */
  const runPolicyCheck = useCallback((action: 'check-in' | 'check-out', lat: number | null, lon: number | null): string | null => {
    const policy = attendancePolicy
    if (policy?.enableGeofence && lat && lon) {
      const loc = policy.officeLocation
      if (loc?.latitude && loc.longitude && loc.radiusMeters) {
        if (!isWithinRadius(lat, lon, loc.latitude, loc.longitude, loc.radiusMeters)) {
          return action === 'check-in'
            ? 'You are outside the allowed geofence area for this office.'
            : 'You are outside the allowed geofence area. Please return to the office to check out.'
        }
      }
    }
    if (policy?.enableNetworkGuard) {
      const net = getNetworkInfo()
      if (policy.wifiOnly && net.networkType !== 'wifi') {
        return action === 'check-in'
          ? 'Only office Wi-Fi is allowed. Please connect to office Wi-Fi.'
          : 'Only office Wi-Fi is allowed for check-out. Please connect to office Wi-Fi.'
      }
      if (policy.wifiOnly && net.networkType === 'wifi' && policy.allowedWifis?.length > 0 && net.wifiSsid) {
        const allowed = policy.allowedWifis.some((w) => w.ssid.toLowerCase() === net.wifiSsid!.toLowerCase())
        if (!allowed) return 'Connected to a non-approved Wi-Fi network.'
      }
      if (net.networkType === 'mobile' && !policy.mobileDataAllowed) {
        return action === 'check-in'
          ? 'Mobile data is not allowed. Please use office Wi-Fi.'
          : 'Mobile data is not allowed for check-out. Please use office Wi-Fi.'
      }
    }
    return null
  }, [attendancePolicy])

  const checkInNow = useCallback(async () => {
    if (!user || checkingIn) return
    if (todayRecord?.checkIn) {
      setMsg({ type: 'error', text: 'You have already checked in today.' })
      return
    }
    setCheckingIn(true)
    setMsg(null)
    try {
      const cid = effectiveCompanyId || user.companyId || ''
      if (!cid) throw new Error('Company is not assigned. Contact your administrator.')

      let lat = gpsStatus?.lat ?? null
      let lon = gpsStatus?.lon ?? null
      try {
        const pos = await getCurrentPosition(5000, 0, true)
        lat = pos.coords.latitude
        lon = pos.coords.longitude
        setGpsStatus({ lat, lon })
      } catch { /* GPS is best-effort; punch proceeds with the last known fix */ }

      // Cloud function first; fall back to direct Firestore only on transport
      // failures (function not deployed / CORS / timeout / unavailable).
      try {
        const { httpsCallable } = await import('firebase/functions')
        const { functions: fns } = await import('../firebase/config')
        const markAttendance = httpsCallable(fns, 'markAttendance')
        const net = getNetworkInfo()
        const result = await markAttendance({
          action: 'check-in',
          companyId: cid,
          latitude: lat,
          longitude: lon,
          wifiSsid: net.wifiSsid,
          networkType: net.networkType,
          isVpn: net.isVpn,
          isMockLocation: false,
          isEmulator: net.isEmulator,
          deviceId,
          deviceModel: navigator.userAgent,
          batteryLevel: 0,
        })
        const data = result.data as { status?: string; lateMinutes?: number; message?: string }
        if (data.status === 'Late' || (data.lateMinutes ?? 0) > 0) {
          notifyAttendanceCascade({
            companyId: cid,
            employeeUserId: user.id,
            employeeName: user.name,
            kind: 'late-checkin',
            dateLabel: new Date().toLocaleDateString(),
            note: data.lateMinutes ? `${data.lateMinutes} min late.` : '',
            actorName: user.name,
          }).catch(() => {})
          setMsg({ type: 'success', text: `Checked in! You are ${data.lateMinutes} min late. Auto-approved.` })
        } else {
          setMsg({ type: 'success', text: data.message || 'Checked in successfully!' })
        }
        logAudit({
          userId: user.id, userName: user.name, userRole: user.role,
          action: 'Checked in via Smart Attendance', actionType: 'create',
          module: 'Attendance', targetEntity: user.name, status: 'success',
        }).catch(() => {})
        // Server confirmed the write — refresh listeners now so Working Mode
        // activates from the verified record instead of waiting out the poll.
        invalidateSnapshots()
        return
      } catch (fnErr: unknown) {
        const ferr = fnErr as { code?: string; message?: string }
        if (ferr.code !== 'functions-not-found' && !ferr.message?.includes('CORS') && !ferr.message?.includes('not found') && ferr.code !== 'unavailable') {
          throw fnErr
        }
      }

      // Direct Firestore fallback — enforce policy client-side too.
      const blocked = runPolicyCheck('check-in', lat, lon)
      if (blocked) {
        setMsg({ type: 'error', text: blocked })
        setCheckingIn(false)
        return
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
        notifyAttendanceCascade({
          companyId: record.companyId || cid,
          employeeUserId: user.id,
          employeeName: user.name,
          kind: 'late-checkin',
          dateLabel: new Date().toLocaleDateString(),
          note: record.lateMinutes ? `${record.lateMinutes} min late.` : '',
          actorName: user.name,
        }).catch(() => {})
        setMsg({ type: 'success', text: `Checked in! You are ${record.lateMinutes} min late. Auto-approved.` })
      } else if (record.status === 'On Leave') {
        setMsg({ type: 'success', text: 'You are on approved leave today. Marked as On Leave.' })
      } else if (isCompanyAdmin || isMasterAdmin) {
        await approveAttendance(record.id, user.id, user.name)
        setMsg({ type: 'success', text: 'Checked in successfully! Auto-approved.' })
      } else {
        setMsg({ type: 'success', text: 'Checked in successfully! Attendance is being processed.' })
      }
      logAudit({
        userId: user.id, userName: user.name, userRole: user.role,
        action: 'Checked in via Smart Attendance', actionType: 'create',
        module: 'Attendance', targetEntity: user.name, status: 'success',
      }).catch(() => {})
      invalidateSnapshots()
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Check-in failed' })
    } finally {
      setCheckingIn(false)
    }
  }, [user, checkingIn, todayRecord?.checkIn, effectiveCompanyId, gpsStatus, employeeData, isCompanyAdmin, isMasterAdmin, runPolicyCheck, deviceId])

  const checkOutNow = useCallback(async () => {
    if (!user || !todayRecord || checkingOut) return
    if (todayRecord.checkOut) {
      setMsg({ type: 'error', text: 'You have already checked out today.' })
      return
    }
    setCheckingOut(true)
    setMsg(null)
    try {
      let lat = gpsStatus?.lat ?? null
      let lon = gpsStatus?.lon ?? null
      try {
        const pos = await getCurrentPosition(5000, 0, true)
        lat = pos.coords.latitude
        lon = pos.coords.longitude
        setGpsStatus({ lat, lon })
      } catch { /* GPS is best-effort; punch proceeds with the last known fix */ }
      const blocked = runPolicyCheck('check-out', lat, lon)
      if (blocked) {
        setMsg({ type: 'error', text: blocked })
        setCheckingOut(false)
        return
      }
      await checkOut(todayRecord.id)
      setMsg({ type: 'success', text: 'Checked out successfully! Your day is complete.' })
      invalidateSnapshots()
      logAudit({
        userId: user.id, userName: user.name, userRole: user.role,
        action: 'Checked out for the day', actionType: 'update',
        module: 'Attendance', targetEntity: user.name, status: 'success',
      }).catch(() => {})
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Check-out failed' })
    } finally {
      setCheckingOut(false)
    }
  }, [user, todayRecord, checkingOut, gpsStatus, runPolicyCheck])

  return {
    todayRecord,
    loading: personal.loading,
    checkingIn,
    checkingOut,
    checkIn: checkInNow,
    checkOut: checkOutNow,
    msg,
    setMsg,
    attendancePolicy,
    gpsStatus,
    isGpsLoading,
    gpsError,
    networkInfo,
    employeeData,
  }
}