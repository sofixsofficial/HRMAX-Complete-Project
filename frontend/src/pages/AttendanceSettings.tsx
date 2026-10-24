import { useState, useEffect, useCallback, useMemo } from 'react'
import { errText } from '../aws/errors';
import { Save, MapPin, Wifi, Shield, Camera, Clock, AlertCircle, Globe, Loader2, Plus, Trash2, Crosshair, Calendar, RefreshCw } from 'lucide-react'
import { Header } from '../components/Header'
import { Toast } from '../components/Toast'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useAuth } from '../context/AuthContext'
import { useCompany } from '../context/CompanyContext'
import { usePermissionScope } from '../hooks/usePermissionScope'
import { useAttendancePolicy } from '../hooks/useAttendancePolicy'
import { saveAttendancePolicy } from '../services/attendanceSettingsService'
import { getShiftsByCompany } from '../services/shiftService'
import { haversineDistance } from '../utils/geoUtils'
import type { AttendancePolicy, WifiConfig, OfficeLocation } from '../types/attendance'
import type { ShiftConfig } from '../types/user'
import './Dashboard.css'

const MODE_LABELS: Record<string, string> = {
  'gps-only': 'GPS Only',
  'gps-wifi': 'GPS + Wi-Fi',
  'gps-wifi-mobile': 'GPS + Wi-Fi + Mobile Data',
  'gps-wifi-selfie': 'GPS + Wi-Fi + Selfie',
}

const MODE_DESCRIPTIONS: Record<string, string> = {
  'gps-only': 'Validate by GPS location only',
  'gps-wifi': 'GPS location + office Wi-Fi required',
  'gps-wifi-mobile': 'GPS + Wi-Fi with mobile data policy',
  'gps-wifi-selfie': 'GPS + Wi-Fi + selfie verification',
}

const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

const SECTIONS = [
  { id: 'mode', label: 'Attendance Mode', icon: Globe },
  { id: 'geofence', label: 'Geofence', icon: MapPin },
  { id: 'network', label: 'Network Guard', icon: Wifi },
  { id: 'timing', label: 'Shift & Timing', icon: Clock },
  { id: 'late', label: 'Late & Absent Rules', icon: AlertCircle },
  { id: 'selfie', label: 'Selfie', icon: Camera },
  { id: 'spoof', label: 'Anti-Spoofing', icon: Shield },
  { id: 'calendar', label: 'Weekend & Holidays', icon: Calendar },
]

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4,
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb',
  fontSize: 14, outline: 'none', boxSizing: 'border-box',
}

function ShimmerBlock({ w = '100%', h = 14, mb = 12 }: { w?: string; h?: number; mb?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: 6,
      background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
      backgroundSize: '800px 100%',
      animation: 'shimmer 1.5s infinite ease-in-out',
      marginBottom: mb,
    }} />
  )
}

function SettingsSkeleton() {
  return (
    <div className="page-container">
      <Header title="Attendance Settings" />
      <div className="page-content">
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ width: 220, flexShrink: 0 }}>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ width: 16, height: 16, borderRadius: 4, background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)', backgroundSize: '800px 100%', animation: 'shimmer 1.5s infinite ease-in-out' }} />
                <ShimmerBlock w="140px" h={13} mb={0} />
              </div>
            ))}
          </div>
          <div style={{ flex: 1, maxWidth: 800 }}>
            <ShimmerBlock w="60%" h={20} mb={20} />
            <ShimmerBlock w="100%" h={14} mb={16} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ height: 80, borderRadius: 10, background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)', backgroundSize: '800px 100%', animation: 'shimmer 1.5s infinite ease-in-out' }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="page-container">
      <Header title="Attendance Settings" />
      <div className="page-content">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '64px 24px', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertCircle size={28} color="#ef4444" />
          </div>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600, color: '#1f2937' }}>Failed to load settings</h3>
            <p style={{ margin: 0, fontSize: 14, color: '#6b7280', maxWidth: 400 }}>{message}</p>
          </div>
          <button onClick={onRetry} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 24px', borderRadius: 8, border: 'none', background: '#f97316', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      </div>
    </div>
  )
}

function AttendanceSettingsForm() {
  const { user } = useAuth()
  const { effectiveCompanyId } = usePermissionScope('attendance')
  const companyId = effectiveCompanyId || user?.companyId || ''

  const { policy, isLoading, error, mutate } = useAttendancePolicy(companyId)

  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [testGeoMsg, setTestGeoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [testingGeo, setTestingGeo] = useState(false)

  const [mode, setMode] = useState<string>('gps-only')
  const [officeLat, setOfficeLat] = useState('')
  const [officeLon, setOfficeLon] = useState('')
  const [officeName, setOfficeName] = useState('')
  const [officeAddress, setOfficeAddress] = useState('')
  const [radiusMeters, setRadiusMeters] = useState(100)
  const [wifiSsids, setWifiSsids] = useState<string[]>([''])
  const [wifiOnly, setWifiOnly] = useState(false)
  const [mobileDataAllowed, setMobileDataAllowed] = useState(true)
  const [enableGeofence, setEnableGeofence] = useState(true)
  const [enableNetworkGuard, setEnableNetworkGuard] = useState(true)
  const [enableAntiSpoofing, setEnableAntiSpoofing] = useState(true)
  const [enableSelfie, setEnableSelfie] = useState(false)
  const [gracePeriod, setGracePeriod] = useState(15)
  const [lateThresholdMinutes, setLateThresholdMinutes] = useState(60)
  const [defaultShiftStart, setDefaultShiftStart] = useState('09:00')
  const [defaultShiftEnd, setDefaultShiftEnd] = useState('18:00')
  const [autoCheckoutMinutes, setAutoCheckoutMinutes] = useState(0)
  const [enableAutoCheckout, setEnableAutoCheckout] = useState(false)
  const [selfieExpirySeconds, setSelfieExpirySeconds] = useState(30)
  const [weekendDays, setWeekendDays] = useState<number[]>([0, 6])
  const [shifts, setShifts] = useState<ShiftConfig[]>([])
  const [selectedShiftId, setSelectedShiftId] = useState('')
  const [holidayCalendarId, setHolidayCalendarId] = useState('')
  const [activeSection, setActiveSection] = useState('mode')

  // Snapshot for optimistic rollback
  const [policySnapshot, setPolicySnapshot] = useState<AttendancePolicy | null>(null)

  // Apply policy data to form fields
  const applyPolicy = useCallback((p: AttendancePolicy) => {
    setPolicySnapshot(JSON.parse(JSON.stringify(p)))
    setMode(p.mode)
    setOfficeLat(String(p.officeLocation.latitude))
    setOfficeLon(String(p.officeLocation.longitude))
    setOfficeName(p.officeLocation.name)
    setOfficeAddress(p.officeLocation.address)
    setRadiusMeters(p.officeLocation.radiusMeters)
    setWifiSsids(p.allowedWifis.map(w => w.ssid))
    setWifiOnly(p.wifiOnly)
    setMobileDataAllowed(p.mobileDataAllowed)
    setEnableGeofence(p.enableGeofence)
    setEnableNetworkGuard(p.enableNetworkGuard)
    setEnableAntiSpoofing(p.enableAntiSpoofing)
    setEnableSelfie(p.enableSelfie)
    setGracePeriod(p.gracePeriodMinutes)
    setLateThresholdMinutes(p.lateThresholdMinutes || 60)
    setDefaultShiftStart(p.defaultShiftStart)
    setDefaultShiftEnd(p.defaultShiftEnd)
    setAutoCheckoutMinutes(p.autoCheckoutMinutes)
    setEnableAutoCheckout(p.enableAutoCheckout)
    setSelfieExpirySeconds(p.selfieExpirySeconds || 30)
    setWeekendDays(p.weekendDays || [0, 6])
    setHolidayCalendarId(p.holidayCalendarId || '')
  }, [])

  // Apply policy when it loads or updates from background sync
  useEffect(() => {
    if (policy) applyPolicy(policy)
  }, [policy, applyPolicy])

  // Load shifts
  useEffect(() => {
    if (!companyId) return
    getShiftsByCompany(companyId).then(setShifts).catch(() => {})
  }, [companyId])

  const toggleWeekendDay = useCallback((day: number) => {
    setWeekendDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }, [])

  const handleAddWifi = useCallback(() => setWifiSsids(prev => [...prev, '']), [])
  const handleRemoveWifi = useCallback((i: number) => setWifiSsids(prev => prev.filter((_, idx) => idx !== i)), [])
  const handleWifiChange = useCallback((i: number, val: string) => {
    setWifiSsids(prev => { const updated = [...prev]; updated[i] = val; return updated })
  }, [])

  const handleTestGeofence = useCallback(async () => {
    setTestingGeo(true)
    setTestGeoMsg(null)
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
      )
      const lat = pos.coords.latitude
      const lon = pos.coords.longitude
      const officeLatNum = parseFloat(officeLat)
      const officeLonNum = parseFloat(officeLon)
      if (!officeLatNum || !officeLonNum) {
        setTestGeoMsg({ type: 'error', text: 'Enter office coordinates first' })
        return
      }
      const distance = haversineDistance(lat, lon, officeLatNum, officeLonNum)
      const within = distance <= radiusMeters
      setTestGeoMsg({
        type: within ? 'success' : 'error',
        text: within
          ? `You are within the geofence (${distance.toFixed(0)}m from office, limit ${radiusMeters}m)`
          : `You are ${distance.toFixed(0)}m from office — exceeds ${radiusMeters}m limit`,
      })
    } catch (err: any) {
      setTestGeoMsg({ type: 'error', text: errText(err, 'GPS unavailable') })
    } finally {
      setTestingGeo(false)
    }
  }, [officeLat, officeLon, radiusMeters])

  const handleSave = useCallback(async () => {
    if (!companyId || !user) return
    setSaving(true)

    const prevPolicy = policySnapshot
    setToast({ type: 'success', message: 'Saving policy...' })

    try {
      const allowedWifis: WifiConfig[] = wifiSsids.filter(s => s.trim()).map(s => ({ ssid: s.trim() }))
      const officeLocation: OfficeLocation = {
        name: officeName || 'Main Office',
        address: officeAddress || '',
        latitude: parseFloat(officeLat) || 0,
        longitude: parseFloat(officeLon) || 0,
        radiusMeters,
      }
      await saveAttendancePolicy(companyId, {
        mode: mode as any,
        officeLocation,
        allowedWifis,
        wifiOnly,
        mobileDataAllowed,
        enableGeofence,
        enableNetworkGuard,
        enableAntiSpoofing,
        enableSelfie,
        requireSelfie: enableSelfie,
        gracePeriodMinutes: gracePeriod,
        lateThresholdMinutes,
        defaultShiftStart,
        defaultShiftEnd,
        autoCheckoutMinutes,
        enableAutoCheckout,
        selfieExpirySeconds,
        weekendDays,
        holidayCalendarId: holidayCalendarId || null,
        updatedBy: user.id,
      } as any)
      setToast({ type: 'success', message: 'Attendance policy saved successfully' })
    } catch (err: any) {
      const errMsg = err?.message || 'Failed to save policy'
      setToast({ type: 'error', message: errMsg })
      if (prevPolicy) applyPolicy(prevPolicy)
    } finally {
      setSaving(false)
    }
  }, [companyId, user, policySnapshot, applyPolicy, mode, officeLat, officeLon, officeName, officeAddress, radiusMeters, wifiSsids, wifiOnly, mobileDataAllowed, enableGeofence, enableNetworkGuard, enableAntiSpoofing, enableSelfie, gracePeriod, lateThresholdMinutes, defaultShiftStart, defaultShiftEnd, autoCheckoutMinutes, enableAutoCheckout, selfieExpirySeconds, weekendDays, holidayCalendarId])

  const sectionContent = useMemo(() => {
    switch (activeSection) {
      case 'mode': return (
        <div className="settings-section">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1f2937' }}><Globe size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Attendance Mode</h3>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Select the primary validation mode for employee check-in. This determines what checks are required.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {Object.entries(MODE_LABELS).map(([key, label]) => (
              <div key={key} onClick={() => setMode(key)} style={{ padding: 16, borderRadius: 10, border: mode === key ? '2px solid #f97316' : '2px solid #e5e7eb', background: mode === key ? '#fff7ed' : '#fff', cursor: 'pointer', transition: 'all 0.15s ease' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#374151', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{MODE_DESCRIPTIONS[key]}</div>
              </div>
            ))}
          </div>
        </div>
      )
      case 'geofence': return (
        <div className="settings-section">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1f2937' }}><MapPin size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Office Location & Geofence</h3>
          <label style={labelStyle}>Enable Geofence Validation</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, marginBottom: 16 }}>
            <input type="checkbox" checked={enableGeofence} onChange={e => setEnableGeofence(e.target.checked)} />
            {enableGeofence ? 'Active — GPS must be within office radius' : 'Disabled — no location check'}
          </label>
          {enableGeofence && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div><label style={labelStyle}>Office Name</label><input style={inputStyle} value={officeName} onChange={e => setOfficeName(e.target.value)} placeholder="Main Office" /></div>
                <div><label style={labelStyle}>Geofence Radius (meters)</label><input type="number" style={inputStyle} value={radiusMeters} onChange={e => setRadiusMeters(Number(e.target.value))} min={10} max={5000} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div><label style={labelStyle}>Latitude</label><input style={inputStyle} value={officeLat} onChange={e => setOfficeLat(e.target.value)} placeholder="28.6139" /></div>
                <div><label style={labelStyle}>Longitude</label><input style={inputStyle} value={officeLon} onChange={e => setOfficeLon(e.target.value)} placeholder="77.2090" /></div>
              </div>
              <div style={{ marginBottom: 12 }}><label style={labelStyle}>Address</label><input style={inputStyle} value={officeAddress} onChange={e => setOfficeAddress(e.target.value)} placeholder="Office address" /></div>
              <button onClick={handleTestGeofence} disabled={testingGeo} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: testingGeo ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500 }}>
                {testingGeo ? <Loader2 className="animate-spin" size={14} /> : <Crosshair size={14} />}
                Test Current Location
              </button>
              {testGeoMsg && <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, fontSize: 13, background: testGeoMsg.type === 'success' ? '#dcfce7' : '#fee2e2', color: testGeoMsg.type === 'success' ? '#16a34a' : '#ef4444' }}>{testGeoMsg.text}</div>}
            </>
          )}
        </div>
      )
      case 'network': return (
        <div className="settings-section">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1f2937' }}><Wifi size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Network Guard</h3>
          <label style={labelStyle}>Enable Network Validation</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, marginBottom: 16 }}>
            <input type="checkbox" checked={enableNetworkGuard} onChange={e => setEnableNetworkGuard(e.target.checked)} />
            {enableNetworkGuard ? 'Active — network type and Wi-Fi validated' : 'Disabled — no network check'}
          </label>
          {enableNetworkGuard && (
            <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, marginBottom: 8 }}>
                <input type="checkbox" checked={wifiOnly} onChange={e => setWifiOnly(e.target.checked)} /> Wi-Fi Only (block mobile data & ethernet)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, marginBottom: 16 }}>
                <input type="checkbox" checked={mobileDataAllowed} onChange={e => setMobileDataAllowed(e.target.checked)} disabled={wifiOnly} /> Allow Mobile Data
              </label>
              <div>
                <label style={labelStyle}>Allowed Office Wi-Fi Networks</label>
                <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Employees must be connected to one of these SSIDs to check in.</p>
                {wifiSsids.map((ssid, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input style={{ ...inputStyle, flex: 1 }} value={ssid} onChange={e => handleWifiChange(i, e.target.value)} placeholder="Office Wi-Fi SSID" />
                    {wifiSsids.length > 1 && <button onClick={() => handleRemoveWifi(i)} style={{ padding: '8px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fee2e2', cursor: 'pointer' }}><Trash2 size={16} color="#ef4444" /></button>}
                  </div>
                ))}
                <button onClick={handleAddWifi} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Add Wi-Fi Network</button>
              </div>
            </>
          )}
        </div>
      )
      case 'timing': return (
        <div className="settings-section">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1f2937' }}><Clock size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Shift & Timing Rules</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><label style={labelStyle}>Default Shift Start</label><input type="time" style={inputStyle} value={defaultShiftStart} onChange={e => setDefaultShiftStart(e.target.value)} /></div>
            <div><label style={labelStyle}>Default Shift End</label><input type="time" style={inputStyle} value={defaultShiftEnd} onChange={e => setDefaultShiftEnd(e.target.value)} /></div>
            <div><label style={labelStyle}>Grace Period (minutes)</label><input type="number" style={inputStyle} value={gracePeriod} onChange={e => setGracePeriod(Number(e.target.value))} min={0} max={120} /><span style={{ fontSize: 11, color: '#9ca3af' }}>Employees arriving within this window after shift start are still marked Present</span></div>
            <div><label style={labelStyle}>Auto Checkout After (minutes, 0=off)</label><input type="number" style={inputStyle} value={autoCheckoutMinutes} onChange={e => setAutoCheckoutMinutes(Number(e.target.value))} min={0} max={480} /><span style={{ fontSize: 11, color: '#9ca3af' }}>Auto-checkout employees who forgot after this many minutes past shift end</span></div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, marginTop: 12 }}>
            <input type="checkbox" checked={enableAutoCheckout} onChange={e => setEnableAutoCheckout(e.target.checked)} /> Enable Auto Checkout
          </label>
          {shifts.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <label style={labelStyle}>Associate with Shift Template</label>
              <select style={inputStyle} value={selectedShiftId} onChange={e => setSelectedShiftId(e.target.value)}>
                <option value="">No specific shift (use default times)</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.startTime}-{s.endTime})</option>)}
              </select>
            </div>
          )}
        </div>
      )
      case 'late': return (
        <div className="settings-section">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1f2937' }}><AlertCircle size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Late & Absent Rules</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><label style={labelStyle}>Late Threshold (minutes)</label><input type="number" style={inputStyle} value={lateThresholdMinutes} onChange={e => setLateThresholdMinutes(Number(e.target.value))} min={1} max={480} /><span style={{ fontSize: 11, color: '#9ca3af' }}>Beyond grace period, how many minutes before marking as Half-Day Absent</span></div>
            <div><label style={labelStyle}>Grace Period</label><div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 14, background: '#f9fafb', color: '#374151' }}>{gracePeriod} minutes</div><span style={{ fontSize: 11, color: '#9ca3af' }}>Configured in Shift & Timing section</span></div>
          </div>
          <div style={{ marginTop: 16, padding: 12, background: '#fff7ed', borderRadius: 8, border: '1px solid #fed7aa', fontSize: 13, color: '#9a3412' }}>
            <strong>Late Policy:</strong> Employees arriving within {gracePeriod} min of shift start → Present. Beyond grace → Late. Beyond {lateThresholdMinutes} min late → may be marked Absent by admin.
          </div>
        </div>
      )
      case 'selfie': return (
        <div className="settings-section">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1f2937' }}><Camera size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Selfie Verification</h3>
          <label style={labelStyle}>Enable Selfie Check-In</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, marginBottom: 16 }}>
            <input type="checkbox" checked={enableSelfie} onChange={e => setEnableSelfie(e.target.checked)} />
            {enableSelfie ? 'Active — selfie capture required for check-in' : 'Disabled'}
          </label>
          {enableSelfie && (
            <>
              <div style={{ marginBottom: 16 }}><label style={labelStyle}>Selfie Verification Window (seconds)</label><input type="number" style={inputStyle} value={selfieExpirySeconds} onChange={e => setSelfieExpirySeconds(Number(e.target.value))} min={10} max={300} /><span style={{ fontSize: 11, color: '#9ca3af' }}>Time window to capture selfie after check-in initiation</span></div>
              <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0', fontSize: 13, color: '#166534' }}><strong>Note:</strong> Selfies are stored securely in encrypted cloud storage and can be reviewed for attendance verification by admins.</div>
            </>
          )}
        </div>
      )
      case 'spoof': return (
        <div className="settings-section">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1f2937' }}><Shield size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Anti-Spoofing</h3>
          <label style={labelStyle}>Enable Anti-Spoofing</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, marginBottom: 16 }}>
            <input type="checkbox" checked={enableAntiSpoofing} onChange={e => setEnableAntiSpoofing(e.target.checked)} />
            {enableAntiSpoofing ? 'Active — mock location & device binding enabled' : 'Disabled'}
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[{ label: 'Mock Location Detection', desc: enableAntiSpoofing ? 'Active — blocks check-in if mock GPS app is detected' : 'Disabled' },
              { label: 'Device Binding', desc: enableAntiSpoofing ? 'Active — first check-in registers device, subsequent ones must match' : 'Disabled' },
              { label: 'Emulator Detection', desc: enableAntiSpoofing ? 'Active — blocks check-in from emulators/simulators' : 'Disabled' },
              { label: 'VPN Detection', desc: enableAntiSpoofing ? 'Active — blocks check-in if VPN/proxy is active' : 'Disabled' },
            ].map(item => (
              <div key={item.label} style={{ padding: 12, background: '#f9fafb', borderRadius: 8, border: '1px solid #e5e7eb' }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#374151', marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{item.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )
      case 'calendar': return (
        <div className="settings-section">
          <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: '#1f2937' }}><Calendar size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Weekend & Holiday Settings</h3>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Weekend Days</label>
            <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Select which days are considered weekends (no attendance required)</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {WEEKDAYS.map(d => (
                <label key={d.value} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '8px 14px', borderRadius: 8, fontSize: 13, background: weekendDays.includes(d.value) ? '#fff7ed' : '#f9fafb', border: weekendDays.includes(d.value) ? '2px solid #f97316' : '2px solid #e5e7eb' }}>
                  <input type="checkbox" checked={weekendDays.includes(d.value)} onChange={() => toggleWeekendDay(d.value)} style={{ display: 'none' }} />
                  {d.label}
                </label>
              ))}
            </div>
          </div>
        </div>
      )
      default: return null
    }
  }, [activeSection, mode, enableGeofence, officeName, officeLat, officeLon, officeAddress, radiusMeters, enableNetworkGuard, wifiSsids, wifiOnly, mobileDataAllowed, enableAntiSpoofing, enableSelfie, selfieExpirySeconds, gracePeriod, lateThresholdMinutes, defaultShiftStart, defaultShiftEnd, autoCheckoutMinutes, enableAutoCheckout, shifts, selectedShiftId, weekendDays, testingGeo, testGeoMsg, handleTestGeofence, handleAddWifi, handleRemoveWifi, handleWifiChange, toggleWeekendDay])

  // ── Loading ──────────────────────────────────────────────────
  if (isLoading) return <SettingsSkeleton />

  // ── Error ────────────────────────────────────────────────────
  if (error) return <SettingsError message={error} onRetry={mutate} />

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="page-container">
      <Header title="Attendance Settings" />
      <div className="page-content">
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ width: 220, flexShrink: 0, position: 'sticky', top: 16 }}>
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              {SECTIONS.map(s => (
                <div key={s.id} onClick={() => setActiveSection(s.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: activeSection === s.id ? '#fff7ed' : 'transparent', color: activeSection === s.id ? '#f97316' : '#374151', borderLeft: activeSection === s.id ? '3px solid #f97316' : '3px solid transparent', transition: 'all 0.12s ease' }}>
                  <s.icon size={16} /> {s.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{ flex: 1, maxWidth: 800 }}>
            {sectionContent}
            <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 28px', borderRadius: 10, border: 'none', background: saving ? '#d1d5db' : '#f97316', color: '#fff', fontSize: 15, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', transition: 'background 0.15s ease' }}>
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                {saving ? 'Saving...' : 'Save Policy'}
              </button>
            </div>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

export function AttendanceSettings() {
  return (
    <ErrorBoundary>
      <AttendanceSettingsForm />
    </ErrorBoundary>
  )
}
