import { describe, it, expect } from 'vitest'
import {
  parseWeekendDays,
  isWeekend,
  isHoliday,
  isWorkingDay,
  countWorkingDays,
  addWorkingDays,
  correctionDeadline,
  isWithinAttendanceCorrectionWindow,
  isWithinSlipCorrectionWindow,
  toDateKey,
} from '../workingDays'

describe('parseWeekendDays', () => {
  it('defaults to Saturday + Sunday when nothing is configured', () => {
    expect(parseWeekendDays()).toEqual([0, 6])
    expect(parseWeekendDays([])).toEqual([0, 6])
  })

  it('parses company weekend names and de-duplicates', () => {
    // order follows the input array
    expect([...parseWeekendDays(['Friday', 'Sunday'])].sort()).toEqual([0, 5])
    expect(parseWeekendDays(['Sunday', 'Sunday'])).toEqual([0])
  })

  it('falls back to the default for unknown names', () => {
    expect(parseWeekendDays(['Funday'])).toEqual([0, 6])
  })
})

describe('isWeekend / isHoliday / isWorkingDay', () => {
  const sun = new Date(2026, 9, 25) // Sunday
  const mon = new Date(2026, 9, 26) // Monday

  it('recognises the weekend', () => {
    expect(isWeekend(sun)).toBe(true)
    expect(isWeekend(mon)).toBe(false)
  })

  it('matches holiday keys by local date', () => {
    expect(isHoliday(mon, [toDateKey(mon)])).toBe(true)
    expect(isHoliday(mon, ['2026-10-27'])).toBe(false)
  })

  it('a working day is not a weekend and not a holiday', () => {
    expect(isWorkingDay(mon, [0, 6], [])).toBe(true)
    expect(isWorkingDay(sun, [0, 6], [])).toBe(false)
    expect(isWorkingDay(mon, [0, 6], [toDateKey(mon)])).toBe(false)
  })
})

describe('countWorkingDays', () => {
  it('is from-exclusive, to-inclusive', () => {
    // Mon 26 → Fri 30 Oct 2026 counts 27, 28, 29, 30 (Sunday-only weekend)
    expect(countWorkingDays(new Date(2026, 9, 26), new Date(2026, 9, 30), [0], [])).toBe(4)
  })

  it('excludes holidays', () => {
    expect(countWorkingDays(new Date(2026, 9, 26), new Date(2026, 9, 30), [0], ['2026-10-28'])).toBe(3)
  })

  it('a same-day range counts 0 (nothing after `from`)', () => {
    expect(countWorkingDays(new Date(2026, 9, 26), new Date(2026, 9, 26), [0], [])).toBe(0)
  })

  it('skips weekends entirely', () => {
    // Fri 30 → Mon 2 Nov: counts 31 (Sat? no — Sat+Sun weekend), so 31 is Sat...
    // Oct 31 2026 is Saturday, Nov 1 Sunday, Nov 2 Monday → only Nov 2 = 1
    expect(countWorkingDays(new Date(2026, 9, 30), new Date(2026, 10, 2), [0, 6], [])).toBe(1)
  })
})

describe('correction windows', () => {
  it('addWorkingDays advances only over working days', () => {
    // From Fri 30 Oct 2026, 2 working days → Tue 3 Nov (Sat + Sun skipped)
    const deadline = addWorkingDays(new Date(2026, 9, 30), 2, [0, 6], [])
    expect(toDateKey(deadline)).toBe('2026-11-03')
    // with a Sunday-only weekend, Saturday counts → Mon 2 Nov
    const sunOnly = addWorkingDays(new Date(2026, 9, 30), 2, [0], [])
    expect(toDateKey(sunOnly)).toBe('2026-11-02')
  })

  it('correctionDeadline returns end-of-day', () => {
    const d = correctionDeadline(new Date(2026, 9, 26), 2, [0], [])
    expect(d.getHours()).toBe(23)
    expect(d.getMinutes()).toBe(59)
  })

  it('attendance window is 2 working days, slip window is 5', () => {
    const friday = new Date(2026, 9, 30, 12, 0)
    expect(isWithinAttendanceCorrectionWindow(friday, friday, [0], [])).toBe(true)
    // three calendar days later (Mon+Tue+Wed = past 2 working days from Fri)
    expect(isWithinAttendanceCorrectionWindow(friday, new Date(2026, 10, 4, 12, 0), [0], [])).toBe(false)
    expect(isWithinSlipCorrectionWindow(friday, new Date(2026, 10, 4, 12, 0), [0], [])).toBe(true)
  })
})
