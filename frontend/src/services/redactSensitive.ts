export function redactPAN(pan: string): string {
  if (!pan || pan.length < 5) return pan || ''
  return pan.slice(0, 5) + 'XXXXX'
}

export function redactAadhaar(aadhaar: string): string {
  if (!aadhaar) return ''
  const digits = aadhaar.replace(/\D/g, '')
  if (digits.length < 4) return aadhaar
  return `XXXX XXXX ${digits.slice(-4)}`
}

export function redactIfPAN(field: string, value: string): string {
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/
  if (panRegex.test(value.toUpperCase())) return redactPAN(value)
  return value
}
