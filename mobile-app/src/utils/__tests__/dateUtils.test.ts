import { describe, it, expect } from '@jest/globals';
import { formatDateSafe, toDateSafe } from '../dateUtils';

describe('toDateSafe', () => {
  it('returns null for empty values', () => {
    expect(toDateSafe(null)).toBeNull();
    expect(toDateSafe(undefined)).toBeNull();
    expect(toDateSafe('not-a-date')).toBeNull();
  });

  it('parses ISO strings and epoch millis', () => {
    expect(toDateSafe('2026-10-26T10:00:00.000Z')?.toISOString()).toBe('2026-10-26T10:00:00.000Z');
    expect(toDateSafe(1793015967620)?.getTime()).toBe(1793015967620);
  });
});

describe('formatDateSafe', () => {
  it('formats without options', () => {
    expect(formatDateSafe('2026-10-26T10:00:00.000Z')).not.toBe('N/A');
  });

  // Regression: toLocaleDateString rejects dateStyle/timeStyle with
  // "Invalid option : timeStyle", which crashed Payroll History and
  // Support Tickets the moment they rendered a timestamp.
  it('accepts dateStyle + timeStyle instead of throwing', () => {
    const out = formatDateSafe('2026-10-26T10:00:00.000Z', undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    } as Intl.DateTimeFormatOptions);
    expect(out).not.toBe('N/A');
    expect(out).toMatch(/26/);
  });

  it('falls back for unparseable input', () => {
    expect(formatDateSafe('garbage')).toBe('N/A');
  });
});
