const crypto = require('crypto')

const pendingVerifications = new Map()
const MAX_2FA_ATTEMPTS = 5
const CODE_TTL_MS = 5 * 60 * 1000

function generate2FACode() {
  return String(crypto.randomInt(100000, 1000000))
}

function store2FASetup(userId, secret) {
  pendingVerifications.set(userId, {
    secret,
    createdAt: Date.now(),
    verified: false,
  })
}

function verify2FASetup(userId, code) {
  const setup = pendingVerifications.get(userId)
  if (!setup) return false
  if (Date.now() - setup.createdAt > CODE_TTL_MS) {
    pendingVerifications.delete(userId)
    return false
  }
  if (code === setup.secret) {
    setup.verified = true
    return true
  }
  return false
}

function is2FAVerified(userId) {
  const setup = pendingVerifications.get(userId)
  return setup && setup.verified
}

function disable2FA(userId) {
  pendingVerifications.delete(userId)
}

function get2FAStatus(userId) {
  const setup = pendingVerifications.get(userId)
  if (!setup) return { enabled: false, verified: false }
  return { enabled: true, verified: setup.verified }
}

module.exports = {
  generate2FACode,
  store2FASetup,
  verify2FASetup,
  is2FAVerified,
  disable2FA,
  get2FAStatus,
  MAX_2FA_ATTEMPTS,
  CODE_TTL_MS,
}
