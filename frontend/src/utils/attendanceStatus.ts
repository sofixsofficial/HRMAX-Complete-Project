/**
 * Shared helpers for determining whether an attendance record represents an
 * active (unresolved) missed punch.  Used by every dashboard count + grid
 * widget so the metric always matches the list.
 *
 * A record is considered an active missed punch when:
 *  - `status` normalises to "miss punch" AND the rectification (if any) has
 *    NOT been resolved, OR
 *  - `missedPunchRectification` has been requested but not yet resolved
 *    (approvalStatus has at least one pending tier or Master Admin gate is
 *    still pending).
 */

// ---------------------------------------------------------------------------
// Status normalisation
// ---------------------------------------------------------------------------

/** Lower-case, collapse _ / whitespace, trim → single canonical token. */
export const normalizeStatusToken = (status?: string | null): string =>
  (status || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** True when the raw status string maps to "miss punch". */
export const isMissPunchStatusToken = (status?: string | null): boolean =>
  normalizeStatusToken(status) === 'miss punch'

// ---------------------------------------------------------------------------
// Rectification predicates
// ---------------------------------------------------------------------------

export const hasPendingMissedPunchRectification = (rec: any): boolean => {
  const mp = rec?.missedPunchRectification
  if (!mp || typeof mp !== 'object') return false
  return mp.requested === true && mp.resolved !== true
}

// ---------------------------------------------------------------------------
// Composite: "active / unresolved missed punch"
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the record counts as an open missed-punch that should
 * appear on dashboard metric cards and grid widgets.
 */
export const isActiveMissedPunchRecord = (rec: any): boolean => {
  if (!rec) return false
  if (hasPendingMissedPunchRectification(rec)) return true
  return isMissPunchStatusToken(rec.status) && rec.missedPunchRectification?.resolved !== true
}

// ---------------------------------------------------------------------------
// Date helpers (duck-typed to handle Firestore Timestamp, Date, string, etc.)
// ---------------------------------------------------------------------------

export const getRecordDate = (rec: any): Date | null => {
  const v = rec?.date
  if (!v) return null
  if (typeof v.getTime === 'function') return v instanceof Date ? v : new Date(v.getTime())
  if (typeof v.toDate === 'function') return v.toDate()
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * True when the record's `date` field is within the look-back window
 * defined by `sinceDate` (inclusive) or has no parseable date at all
 * (still counts so the metric isn't silently undercounted).
 */
export const isWithinRecentWindow = (rec: any, sinceDate: Date): boolean => {
  const d = getRecordDate(rec)
  if (!d) return true
  return d.getTime() >= sinceDate.getTime()
}

/**
 * Build a 14-day look-back anchor.  Covers the 2-working-day attendance
 * correction window plus weekends, plus a buffer for slow tier approvals.
 */
export const recentMissPunchSinceDate = (now: Date = new Date()): Date => {
  const since = new Date(now)
  since.setDate(since.getDate() - 14)
  since.setHours(0, 0, 0, 0)
  return since
}
