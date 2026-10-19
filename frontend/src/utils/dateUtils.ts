/**
 * Safe date check that works across Vite code-split chunks.
 * Uses duck-typing to avoid instanceof Date which breaks when
 * Date constructor is duplicated across chunk boundaries.
 */
export function isDate(value: unknown): value is Date {
  if (value === null || typeof value !== 'object') return false
  if (typeof (value as any).getTime !== 'function') return false
  return !isNaN((value as any).getTime())
}

/**
 * Convert any value to a Date safely.
 * Handles Firestore Timestamp, Date, string, and null/undefined.
 */
export function toDate(value: unknown): Date | null {
  if (!value) return null
  if (isDate(value)) return value
  if (typeof (value as any)?.toDate === 'function') return (value as any).toDate()
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}
