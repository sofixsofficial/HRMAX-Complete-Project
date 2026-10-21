/**
 * CENTRALIZED CHARACTER-MODE RESOLVER
 * ===================================
 * Single source of truth for the dashboard hero's employee character mode.
 * Shared across web and mobile so every platform derives the SAME mode from
 * the SAME authoritative backend records — never from a frontend guess.
 *
 * Precedence (SECTION 5B):
 *   1. Active working session        → WORKING  (never silently discarded)
 *   2. Approved full-day leave       → ON LEAVE (pending/rejected never count)
 *   3. Company holiday / weekly off  → HOLIDAY / WEEKLY OFF
 *   4. Confirmed check-out           → HAPPY / DAY COMPLETE
 *   5. Otherwise                     → RESTING / NOT CHECKED IN
 *
 * A valid active work session is never overridden by an overlapping leave or
 * holiday record — the caller should surface such a conflict via the attendance
 * policy rather than dropping the session here.
 */

export type CharacterMode = 'resting' | 'working' | 'complete' | 'on_leave' | 'holiday'

export interface DayContextInput {
  /** Server-confirmed check-in exists for today. */
  hasCheckIn: boolean
  /** Server-confirmed check-out exists for today. */
  hasCheckOut: boolean
  /** An APPROVED full-day leave covers today (pending/rejected excluded). */
  onApprovedLeave: boolean
  /** An APPROVED half-day leave covers today (period handling is a caller concern). */
  halfDayLeave: boolean
  /** The company holiday calendar marks today as a holiday. */
  isHoliday: boolean
  /** Display label for the holiday (real holiday name). */
  holidayLabel?: string
  /** The assigned weekly-off schedule marks today as a non-working day. */
  isWeeklyOff: boolean
  /** Display label for the weekly-off day (e.g. "Sunday"). */
  weekendLabel?: string
}

export interface ResolvedMode {
  mode: CharacterMode
  /** Status-pill text. */
  pill: string
  /** Maps to `.dh-status[data-state]` (web) / status styling (mobile). */
  pillState: 'idle' | 'working' | 'done' | 'leave' | 'holiday'
  /** Whether the employee may check in right now. */
  canCheckIn: boolean
  /** Whether the employee may check out right now. */
  canCheckOut: boolean
}

/**
 * Pure, dependency-free resolver. Feed it authoritative backend facts and it
 * returns the single character mode + status pill every platform should show.
 */
export function resolveCharacterMode(input: DayContextInput): ResolvedMode {
  const activeSession = input.hasCheckIn && !input.hasCheckOut
  const completed = input.hasCheckIn && input.hasCheckOut

  // 1 — Active working session wins; an approved leave/holiday must not discard it.
  if (activeSession) {
    return { mode: 'working', pill: 'Working', pillState: 'working', canCheckIn: false, canCheckOut: true }
  }

  // 2 — Approved full-day leave (only approved records ever reach this flag).
  if (input.onApprovedLeave) {
    return { mode: 'on_leave', pill: 'On Leave', pillState: 'leave', canCheckIn: false, canCheckOut: false }
  }

  // 3 — Configured holiday calendar, then assigned weekly-off schedule.
  if (input.isHoliday) {
    return { mode: 'holiday', pill: input.holidayLabel || 'Holiday', pillState: 'holiday', canCheckIn: false, canCheckOut: false }
  }
  if (input.isWeeklyOff) {
    return { mode: 'holiday', pill: input.weekendLabel || 'Weekly Off', pillState: 'holiday', canCheckIn: false, canCheckOut: false }
  }

  // 4 — Confirmed check-out → day complete.
  if (completed) {
    return { mode: 'complete', pill: 'Checked Out', pillState: 'done', canCheckIn: false, canCheckOut: false }
  }

  // 5 — Resting / eligible to check in.
  return { mode: 'resting', pill: 'Not Checked In', pillState: 'idle', canCheckIn: true, canCheckOut: false }
}
