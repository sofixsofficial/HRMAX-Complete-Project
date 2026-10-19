export function toDateSafe(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDateSafe(value: any, locale = 'en-IN', options?: Intl.DateTimeFormatOptions): string {
  const d = toDateSafe(value);
  return d ? d.toLocaleDateString(locale, options) : 'N/A';
}
