import { describe, it, expect, afterEach } from '@jest/globals';
import { dayKey, addDays } from '../attendanceDate';

describe('dayKey', () => {
  it('formats as YYYY-MM-DD with zero padding', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('uses the local calendar date, not UTC (a 00:30 IST punch must stay on its day)', () => {
    // 2026-10-26 00:30 IST = 2026-10-25 19:00 UTC — the UTC date would be wrong.
    const local = new Date(2026, 9, 26, 0, 30);
    expect(dayKey(local)).toBe('2026-10-26');
    expect(dayKey(local).startsWith('2026-10-26')).toBe(true);
  });

  it('is lexicographically sortable, which is what the range queries rely on', () => {
    const a = dayKey(new Date(2026, 9, 9));
    const b = dayKey(new Date(2026, 9, 10));
    expect(a < b).toBe(true);
  });

  it('matches the format the API writes, so ranges hit both formats', () => {
    const key = dayKey(new Date(2026, 9, 26));
    // server format: '2026-10-26'
    expect(key).toBe('2026-10-26');
    // legacy instant: '2026-10-26T09:51:00.000Z' falls in [key, nextKey)
    const next = dayKey(addDays(new Date(2026, 9, 26), 1));
    const legacy = '2026-10-26T09:51:00.000Z';
    expect(key <= legacy && legacy < next).toBe(true);
  });
});

describe('addDays', () => {
  it('does not mutate the input', () => {
    const d = new Date(2026, 9, 26);
    addDays(d, 5);
    expect(d.getDate()).toBe(26);
  });

  it('crosses month and year boundaries', () => {
    expect(dayKey(addDays(new Date(2026, 11, 31), 1))).toBe('2027-01-01');
    expect(dayKey(addDays(new Date(2026, 0, 1), -1))).toBe('2025-12-31');
  });

  it('moves backwards too', () => {
    expect(dayKey(addDays(new Date(2026, 2, 1), -1))).toBe('2026-02-28');
  });
});
