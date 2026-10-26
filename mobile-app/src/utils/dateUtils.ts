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
  if (!d) return 'N/A';
  // toLocaleDateString rejects dateStyle/timeStyle ("Invalid option : timeStyle"),
  // which crashed the Payroll History and Support screens the moment they rendered
  // a timestamp - Intl.DateTimeFormat accepts the same options.
  if (options) {
    try {
      return new Intl.DateTimeFormat(locale, options).format(d);
    } catch {
      return d.toLocaleDateString(locale);
    }
  }
  return d.toLocaleDateString(locale);
}
