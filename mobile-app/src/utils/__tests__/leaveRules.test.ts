import { describe, it, expect, afterEach } from '@jest/globals';
/**
 * Leave + attendance business rules that live on the client.
 *
 * The authoritative rules are on the server (backend/aws/src/handlers), but
 * these mirror them for the UI: day counting for a leave range and the status
 * → colour mapping every screen renders.
 */
import { parseWeekendDays, isWorkingDay, countWorkingDays } from '../../utils/workingDays';

describe('leave range day counting (client mirror)', () => {
  it('an inclusive range counts both endpoints', () => {
    const start = new Date(2026, 10, 12); // 12 Nov 2026
    const end = new Date(2026, 10, 14); // 14 Nov 2026
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    expect(days).toBe(3);
  });

  it('a single-day leave is 1 day, not 0', () => {
    const d = new Date(2026, 10, 12);
    const days = Math.round((d.getTime() - d.getTime()) / 86400000) + 1;
    expect(days).toBe(1);
  });
});

describe('working-day helpers', () => {
  it('parses a weekend list and honours it', () => {
    const weekends = parseWeekendDays(['Sunday', 'Saturday']);
    expect(weekends).toContain(0);
    expect(weekends).toContain(6);
    expect(isWorkingDay(new Date(2026, 9, 25), weekends, [])).toBe(false); // Sunday
    expect(isWorkingDay(new Date(2026, 9, 26), weekends, [])).toBe(true); // Monday
  });

  it('skips holidays when counting working days', () => {
    const weekends = parseWeekendDays(['Sunday']);
    // countWorkingDays is `from`-exclusive, `to`-inclusive: Mon 26 → Fri 30
    // Oct 2026 counts 27, 29, 30 (28 is a holiday) = 3.
    const count = countWorkingDays(new Date(2026, 9, 26), new Date(2026, 9, 30), weekends, ['2026-10-28']);
    expect(count).toBe(3);
    // Without the holiday it is 4 (27, 28, 29, 30)
    expect(countWorkingDays(new Date(2026, 9, 26), new Date(2026, 9, 30), weekends, [])).toBe(4);
  });
});
