const crypto = require('crypto')
const config = require('../config')
const { refreshTokens, consumedRefreshTokens, passwordResets } = require('../db/memory')

const REUSE_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_CONSUMED = 5000
const MAX_SESSIONS_PER_USER = 5

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function timingEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex || ''), 'hex')
    const b = Buffer.from(String(bHex || ''), 'hex')
    return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function pruneConsumed() {
  const now = Date.now()
  for (const [hash, record] of consumedRefreshTokens) {
    if (now > record.expiresAt) consumedRefreshTokens.delete(hash)
  }
  if (consumedRefreshTokens.size > MAX_CONSUMED) {
    const excess = consumedRefreshTokens.size - MAX_CONSUMED
    const keys = consumedRefreshTokens.keys()
    for (let i = 0; i < excess; i += 1) consumedRefreshTokens.delete(keys.next().value)
  }
}

function getUserSessionCount(userId) {
  let count = 0
  for (const [, record] of refreshTokens) {
    if (record.userId === userId) count++
  }
  return count
}

function pruneOldestSession(userId) {
  let oldest = null
  let oldestKey = null
  for (const [key, record] of refreshTokens) {
    if (record.userId === userId) {
      if (!oldest || record.createdAt < oldest.createdAt) {
        oldest = record
        oldestKey = key
      }
    }
  }
  if (oldestKey) refreshTokens.delete(oldestKey)
}

function issueRefreshToken(userId, tokenVersion = 0) {
  if (getUserSessionCount(userId) >= MAX_SESSIONS_PER_USER) {
    pruneOldestSession(userId)
  }
  const raw = crypto.randomBytes(48).toString('hex')
  const hash = sha256(raw)
  refreshTokens.set(hash, {
    userId,
    tokenVersion,
    expiresAt: Date.now() + config.refreshTokenTtlMs,
    createdAt: Date.now(),
  })
  return raw
}

// Read without consuming before a database await. The caller must consume again
// after the lookup; rotation and replacement then run in one synchronous turn.
function inspectRefreshToken(raw) {
  pruneConsumed()
  const hash = sha256(raw || '')
  const record = refreshTokens.get(hash)
  if (record) return Date.now() > record.expiresAt ? null : { ...record }
  const consumed = consumedRefreshTokens.get(hash)
  return consumed ? { reused: true, userId: consumed.userId } : null
}

function consumeRefreshToken(raw) {
  pruneConsumed()
  const hash = sha256(raw || '')
  const entry = [...refreshTokens.entries()].find(([stored]) =>
    timingEqualHex(stored, hash)
  )
  if (!entry) {
    const replayed = [...consumedRefreshTokens.entries()].find(([stored]) =>
      timingEqualHex(stored, hash)
    )
    if (replayed) {
      const [, record] = replayed
      revokeUserRefreshTokens(record.userId)
      consumedRefreshTokens.delete(replayed[0])
      return { reused: true, userId: record.userId }
    }
    return null
  }
  const [key, record] = entry
  refreshTokens.delete(key)
  if (Date.now() > record.expiresAt) return null
  consumedRefreshTokens.set(key, {
    userId: record.userId,
    expiresAt: Math.min(record.expiresAt, Date.now() + REUSE_WINDOW_MS),
  })
  return record
}

function revokeRefreshToken(raw) {
  if (!raw) return
  const hash = sha256(raw)
  for (const stored of [...refreshTokens.keys()]) {
    if (timingEqualHex(stored, hash)) refreshTokens.delete(stored)
  }
}

function revokeUserRefreshTokens(userId) {
  for (const [key, record] of [...refreshTokens.entries()]) {
    if (record.userId === userId) refreshTokens.delete(key)
  }
}

function listUserSessions(userId) {
  const sessions = []
  for (const [hash, record] of refreshTokens) {
    if (record.userId === userId) {
      sessions.push({
        id: hash.slice(0, 8),
        createdAt: new Date(record.createdAt).toISOString(),
        expiresAt: new Date(record.expiresAt).toISOString(),
      })
    }
  }
  return sessions
}

function issuePasswordReset(email, tokenVersion = 0) {
  const raw = crypto.randomBytes(32).toString('hex')
  const key = String(email).toLowerCase()
  passwordResets.set(sha256(raw), { emailKey: key, tokenVersion, expiresAt: Date.now() + config.passwordResetTtlMs, createdAt: Date.now() })
  for (const [hash, record] of [...passwordResets.entries()]) {
    if (record.emailKey === key && hash !== sha256(raw)) passwordResets.delete(hash)
  }
  return raw
}

// Consume before any await: concurrent requests cannot claim the same reset.
// A database failure burns the token; request a new link rather than replaying
// an update whose commit outcome may be unknown.
function consumePasswordReset(raw) {
  const hash = sha256(raw || '')
  const match = [...passwordResets.entries()].find(([stored]) => timingEqualHex(stored, hash))
  if (!match) return null
  const [key, record] = match
  passwordResets.delete(key)
  if (Date.now() > record.expiresAt) return null
  return record
}

module.exports = {
  issueRefreshToken,
  consumeRefreshToken,
  inspectRefreshToken,
  revokeRefreshToken,
  revokeUserRefreshTokens,
  listUserSessions,
  issuePasswordReset,
  consumePasswordReset,
  getUserSessionCount,
  MAX_SESSIONS_PER_USER,
}
