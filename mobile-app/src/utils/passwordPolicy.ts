/**
 * Password policy — single source of truth for the mobile app.
 * MUST stay in sync with backend/aws/src/handlers/auth.ts#validatePasswordPolicy
 * and frontend/src/utils/passwordPolicy.ts.
 *
 * Enforcement note: this policy applies only when SETTING a new password
 * (reset, change, invite). Sign-in never applies it, so existing accounts
 * with historical passwords are unaffected.
 */

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_REQUIREMENTS = [
  { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (p: string) => p.length >= PASSWORD_MIN_LENGTH },
  { id: 'uppercase', label: 'At least one uppercase letter (A-Z)', test: (p: string) => /[A-Z]/.test(p) },
  { id: 'lowercase', label: 'At least one lowercase letter (a-z)', test: (p: string) => /[a-z]/.test(p) },
  { id: 'number', label: 'At least one number (0-9)', test: (p: string) => /[0-9]/.test(p) },
  { id: 'special', label: 'At least one special symbol (! @ # $ % & *)', test: (p: string) => /[!@#$%&*]/.test(p) },
];

export function validatePasswordPolicy(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter (A-Z).');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter (a-z).');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number (0-9).');
  }
  if (!/[!@#$%&*]/.test(password)) {
    errors.push('Password must contain at least one special symbol (! @ # $ % & *).');
  }
  return { valid: errors.length === 0, errors };
}

export function getPasswordStrength(pw: string): { score: number; label: string; color: string; metCount: number } {
  let metCount = 0;
  for (const req of PASSWORD_REQUIREMENTS) {
    if (req.test(pw)) metCount++;
  }
  const score = metCount; // 0-5
  const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  const colors = ['#dc2626', '#f59e0b', '#eab308', '#22c55e', '#16a34a', '#15803d'];
  return { score, label: labels[score] || labels[0], color: colors[score] || colors[0], metCount };
}
