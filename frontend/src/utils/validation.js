export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(email) {
  if (typeof email !== 'string' || !email.trim()) return 'Email is required.'
  if (!emailPattern.test(email.trim())) return 'Enter a valid email address.'
  return ''
}

export function validatePassword(password) {
  if (!password) return 'Password is required.'
  if (password.length < 8) return 'Password must be at least 8 characters.'
  return ''
}

// Mirrors the backend strong-password policy (min 8 + upper/lower/digit/symbol).
export function passwordChecks(password) {
  const value = typeof password === 'string' ? password : ''
  return [
    { label: 'At least 8 characters', ok: value.length >= 8 },
    { label: 'Uppercase letter (A–Z)', ok: /[A-Z]/.test(value) },
    { label: 'Lowercase letter (a–z)', ok: /[a-z]/.test(value) },
    { label: 'Number (0–9)', ok: /\d/.test(value) },
    { label: 'Symbol (!@#…)', ok: /[^A-Za-z0-9]/.test(value) },
  ]
}

export function passwordScore(password) {
  return passwordChecks(password).filter((check) => check.ok).length
}

export function strengthLabel(score) {
  if (score <= 1) return { label: 'Weak', color: '#f87171' }
  if (score === 2) return { label: 'Fair', color: '#fbbf24' }
  if (score === 3) return { label: 'Good', color: '#34d399' }
  return { label: 'Strong', color: '#34d399' }
}

export function validateStrongPassword(password) {
  if (!password) return 'Password is required.'
  if (password.length < 8 || password.length > 128) return 'Password must be between 8 and 128 characters.'
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include an uppercase letter, a lowercase letter, a number, and a symbol.'
  }
  return ''
}
