import { Loader2, LogIn, LogOut, MapPin, Wifi, Globe, AlertCircle, CheckCircle } from 'lucide-react'
import { useAttendancePunch } from '../hooks/useAttendancePunch'

/**
 * Universal orange "Start Your Day" check-in / check-out banner shown on every
 * personal attendance surface (My Attendance page, dashboard cards, all role
 * portals including Master Admin).
 *
 * Dynamic state:
 *  - not checked in today  -> orange gradient hero + primary "Check In" button
 *  - checked in, not out   -> "Checked In" hero + mandatory "Check Out" button
 *  - day complete          -> "Day Complete" hero (both punches logged)
 *
 * Punches run through `useAttendancePunch` (cloud function first, direct
 * Firestore fallback, duplicate-punch guard, geofence / network policy, live
 * onSnapshot refresh) so the stats widgets and attendance table logs update
 * instantly after every action.
 */
type PunchDateValue = Date | { toDate: () => Date } | string | null | undefined

const fmtTime = (v: PunchDateValue): string => {
  if (!v) return '--:--'
  const d = v instanceof Date ? v : typeof v === 'string' ? new Date(v) : v.toDate()
  if (isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export function AttendancePunchBanner() {
  const {
    todayRecord, checkingIn, checkingOut, checkIn, checkOut, msg, attendancePolicy,
    gpsStatus, isGpsLoading, networkInfo, qrToken, setQrToken,
  } = useAttendancePunch()

  const punchedIn = !!todayRecord?.checkIn
  const punchedOut = !!todayRecord?.checkOut
  // Company policy `enableQr` = the branch's QR code must be presented. The
  // server validates the token against the branch; this only avoids a
  // pointless round-trip with an empty field.
  const qrRequired = Boolean(attendancePolicy?.enableQr)
  const canCheckIn = !qrRequired || qrToken.trim().length > 0

  return (
    <div style={{
      background: 'linear-gradient(135deg, #f97316, #ea580c)', borderRadius: 16,
      padding: 24, marginBottom: 24, color: '#fff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
            {punchedOut ? 'Day Complete' : punchedIn ? 'Checked In' : 'Start Your Day'}
          </h2>
          <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: 14 }}>
            {punchedOut
              ? `Checked out at ${fmtTime(todayRecord?.checkOut)} · ${todayRecord?.workHours?.toFixed(1)}h worked`
              : punchedIn
                ? `Checked in at ${fmtTime(todayRecord?.checkIn)} · awaiting check-out`
                : 'Mark your attendance for today'}
          </p>
          {todayRecord?.status === 'Late' && (
            <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: 13 }}>
              <AlertCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              {todayRecord.lateMinutes} min late · Auto-approved
            </p>
          )}
          {todayRecord?.isAutoApproved && punchedOut && (
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

          {msg && (
            <p style={{
              margin: '8px 0 0', fontSize: 13, fontWeight: 600,
              color: msg.type === 'success' ? '#dcfce7' : '#fee2e2',
            }}>
              {msg.text}
            </p>
          )}

          {!punchedIn && (
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

        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {!punchedIn && qrRequired && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input
                value={qrToken}
                onChange={(e) => setQrToken(e.target.value)}
                placeholder="Scan or enter branch QR code"
                aria-label="Branch QR code"
                style={{
                  padding: '10px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.5)',
                  background: 'rgba(255,255,255,0.95)', minWidth: 240, fontSize: 14, color: '#111827',
                }}
              />
              <span style={{ fontSize: 11, opacity: 0.9 }}>
                QR attendance is enabled for your company — use the code posted at your branch.
              </span>
            </div>
          )}
          {!punchedIn && (
            <button onClick={() => void checkIn()} disabled={checkingIn || !canCheckIn}
              title={!canCheckIn ? 'Enter the branch QR code first' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '12px 28px',
                borderRadius: 12, border: 'none', background: 'rgba(255,255,255,0.2)',
                color: '#fff', fontSize: 16, fontWeight: 600,
                cursor: checkingIn || !canCheckIn ? 'not-allowed' : 'pointer',
                opacity: canCheckIn ? 1 : 0.6,
                backdropFilter: 'blur(4px)',
              }}>
              {checkingIn ? <Loader2 className="animate-spin" size={20} /> : <LogIn size={20} />}
              Check In
            </button>
          )}
          {punchedIn && !punchedOut && (
            <button onClick={checkOut} disabled={checkingOut}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '12px 28px',
                borderRadius: 12, border: 'none', background: '#fff',
                color: '#ea580c', fontSize: 16, fontWeight: 600, cursor: checkingOut ? 'not-allowed' : 'pointer',
              }}>
              {checkingOut ? <Loader2 className="animate-spin" size={20} /> : <LogOut size={20} />}
              Check Out
            </button>
          )}
        </div>
      </div>
    </div>
  )
}