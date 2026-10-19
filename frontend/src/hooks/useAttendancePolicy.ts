import { useState, useEffect, useRef } from 'react'
import { subscribeAttendancePolicy } from '../services/attendanceSettingsService'
import type { AttendancePolicy } from '../types/attendance'

const CACHE_KEY = 'attendance_policy_cache'

interface UseAttendancePolicyResult {
  policy: AttendancePolicy | null
  isLoading: boolean
  error: string | null
  mutate: () => void
}

function getCached(companyId: string): AttendancePolicy | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_KEY}_${companyId}`)
    if (raw) return JSON.parse(raw)
  } catch {}
  return null
}

function setCache(companyId: string, policy: AttendancePolicy | null) {
  try {
    if (policy) {
      sessionStorage.setItem(`${CACHE_KEY}_${companyId}`, JSON.stringify(policy))
    } else {
      sessionStorage.removeItem(`${CACHE_KEY}_${companyId}`)
    }
  } catch {}
}

export function useAttendancePolicy(companyId: string): UseAttendancePolicyResult {
  const cached = companyId ? getCached(companyId) : null
  const [policy, setPolicy] = useState<AttendancePolicy | null>(cached)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(!cached)
  const prevCompanyId = useRef(companyId)

  // Force re-fetch
  const [refreshKey, setRefreshKey] = useState(0)
  const mutate = () => {
    setRefreshKey(k => k + 1)
    setIsLoading(true)
  }

  useEffect(() => {
    if (!companyId) {
      setPolicy(null)
      setIsLoading(false)
      return
    }

    // If company changed, clear stale cache state
    if (prevCompanyId.current !== companyId) {
      const freshCached = getCached(companyId)
      if (freshCached) {
        setPolicy(freshCached)
        setIsLoading(false)
      } else {
        setPolicy(null)
        setIsLoading(true)
      }
      prevCompanyId.current = companyId
    }

    const unsub = subscribeAttendancePolicy(companyId, (p) => {
      setPolicy(p)
      setCache(companyId, p)
      setIsLoading(false)
      setError(null)
    }, (err) => {
      console.error('[useAttendancePolicy] error:', err)
      setError(err?.message || 'Failed to load attendance settings')
      setIsLoading(false)
    })

    return () => unsub()
  }, [companyId, refreshKey])

  return { policy, isLoading, error, mutate }
}
