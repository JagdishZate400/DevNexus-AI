const crypto = require('crypto')

const securityEvents = []
const MAX_EVENTS = 1000
const SUSPICIOUS_THRESHOLDS = {
  failedLogins: 5,
  failedLoginsWindowMs: 15 * 60 * 1000,
  passwordResets: 3,
  passwordResetsWindowMs: 60 * 60 * 1000,
}

function logSecurityEvent(event) {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...event,
  }
  securityEvents.unshift(entry)
  if (securityEvents.length > MAX_EVENTS) {
    securityEvents.length = MAX_EVENTS
  }
  return entry
}

function getSecurityEvents(filters = {}) {
  let events = [...securityEvents]
  if (filters.type) events = events.filter((e) => e.type === filters.type)
  if (filters.userId) events = events.filter((e) => e.userId === filters.userId)
  if (filters.email) events = events.filter((e) => e.email === filters.email)
  if (filters.since) events = events.filter((e) => new Date(e.timestamp) >= new Date(filters.since))
  return events
}

function detectSuspiciousActivity(email) {
  const now = Date.now()
  const alerts = []

  const recentFailedLogins = securityEvents.filter(
    (e) => e.type === 'failed_login' && e.email === email && now - new Date(e.timestamp).getTime() < SUSPICIOUS_THRESHOLDS.failedLoginsWindowMs
  )
  if (recentFailedLogins.length >= SUSPICIOUS_THRESHOLDS.failedLogins) {
    alerts.push({
      type: 'brute_force',
      message: `Multiple failed login attempts for ${email}`,
      count: recentFailedLogins.length,
    })
  }

  const recentPasswordResets = securityEvents.filter(
    (e) => e.type === 'password_reset_requested' && e.email === email && now - new Date(e.timestamp).getTime() < SUSPICIOUS_THRESHOLDS.passwordResetsWindowMs
  )
  if (recentPasswordResets.length >= SUSPICIOUS_THRESHOLDS.passwordResets) {
    alerts.push({
      type: 'password_reset_abuse',
      message: `Multiple password reset requests for ${email}`,
      count: recentPasswordResets.length,
    })
  }

  return alerts
}

function clearSecurityEvents() {
  securityEvents.length = 0
}

module.exports = {
  logSecurityEvent,
  getSecurityEvents,
  detectSuspiciousActivity,
  clearSecurityEvents,
  SUSPICIOUS_THRESHOLDS,
}
