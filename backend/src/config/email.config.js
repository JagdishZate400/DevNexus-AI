const config = require('../config')

const PLACEHOLDER_USERS = new Set([
  'your@gmail.com',
  'you@gmail.com',
  'user@example.com',
  'no-reply@example.com',
  'no-reply@localhost',
])

const PLACEHOLDER_PASSES = new Set([
  'your-16-char-app-password',
  'your-app-password',
  'changeme',
  'password',
  'app-password',
])

function trim(value) {
  return String(value || '').trim()
}

function hasPlaceholderSmtpCredentials() {
  const user = trim(config.smtpUser).toLowerCase()
  const pass = trim(config.smtpPass)
  if (!user || !pass) return true
  if (PLACEHOLDER_USERS.has(user)) return true
  if (PLACEHOLDER_PASSES.has(pass.toLowerCase())) return true
  if (/^your[-_]/i.test(pass)) return true
  return false
}

const host = trim(config.smtpHost)
const user = trim(config.smtpUser)
const pass = trim(config.smtpPass)

const emailConfig = {
  smtp: host
    ? {
        host,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: user && pass ? { user, pass } : undefined,
      }
    : null,
  from: trim(config.emailFrom) || (user ? `${config.appName} <${user}>` : `${config.appName} <no-reply@localhost>`),
  appName: config.appName,
  appUrl: process.env.APP_URL || 'http://localhost:5173',
}

function isEmailConfigured() {
  return Boolean(emailConfig.smtp && emailConfig.smtp.host && emailConfig.smtp.auth)
}

module.exports = {
  emailConfig,
  isEmailConfigured,
  hasPlaceholderSmtpCredentials,
}
