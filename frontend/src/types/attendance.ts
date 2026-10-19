export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'On Leave' | 'Approved' | 'Miss Punch' | 'Early Checkout'

export type AttendanceMode = 'gps-only' | 'gps-wifi' | 'gps-wifi-mobile' | 'gps-wifi-selfie'

export interface GeoPoint {
  latitude: number
  longitude: number
}

export interface OfficeLocation {
  name: string
  address: string
  latitude: number
  longitude: number
  radiusMeters: number
}

export interface WifiConfig {
  ssid: string
  bssid?: string
}

export interface AttendancePolicy {
  id: string
  companyId: string
  mode: AttendanceMode
  officeLocation: OfficeLocation
  allowedWifis: WifiConfig[]
  wifiOnly: boolean
  mobileDataAllowed: boolean
  requireSelfie: boolean
  selfieExpirySeconds: number
  gracePeriodMinutes: number
  lateThresholdMinutes: number
  autoCheckoutMinutes: number
  enableAutoCheckout: boolean
  defaultShiftStart: string
  defaultShiftEnd: string
  weekendDays: number[]
  holidayCalendarId: string | null
  enableGeofence: boolean
  enableNetworkGuard: boolean
  enableAntiSpoofing: boolean
  enableSelfie: boolean
  updatedAt: Date
  updatedBy: string
  createdBy: string
  createdAt: Date
}

export interface AttendanceLog {
  id: string
  attendanceId: string | null
  userId: string
  companyId: string
  action: 'check-in' | 'check-out' | 'verify'
  status: 'success' | 'failure'
  reasonCode: string | null
  reasonMessage: string | null
  latitude: number | null
  longitude: number | null
  deviceId: string | null
  deviceModel: string | null
  batteryLevel: number | null
  networkType: string | null
  wifiSsid: string | null
  isVpn: boolean | null
  isMockLocation: boolean | null
  isEmulator: boolean | null
  ipAddress: string | null
  timestamp: Date
}

export interface AttendanceSummary {
  total: number
  present: number
  late: number
  absent: number
  onLeave: number
  missPunch: number
  earlyCheckout: number
  workingHoursAvg: number
  overtimeAvg: number
}

export interface EmployeeAttendanceStats {
  userId: string
  employeeName: string
  employeeId: string
  department: string
  presentDays: number
  lateDays: number
  absentDays: number
  approvedLeaveDays: number
  missPunchDays: number
  totalWorkingHours: number
  totalOvertimeHours: number
  attendancePercentage: number
}
