// Append-only activity feed backing the dashboard / reports UI.
// In-memory (capped at 500). A Postgres implementation would INSERT here and
// SELECT with pagination — route code stays identical.
const crypto = require('crypto')
const { activity } = require('../db/memory')

const MAX_ENTRIES = 500

function logActivity({ type, message, actorEmail, projectId = null, metadata = {} }) {
  const entry = {
    id: `act-${crypto.randomUUID().slice(0, 8)}`,
    type: String(type || 'general'),
    message: String(message || ''),
    actorEmail: actorEmail || null,
    projectId,
    metadata,
    createdAt: new Date().toISOString(),
  }
  activity.unshift(entry)
  if (activity.length > MAX_ENTRIES) activity.length = MAX_ENTRIES
  return entry
}

function listActivity({ type, projectId, limit = 50 } = {}) {
  let list = activity
  if (type) list = list.filter((a) => a.type === type)
  if (projectId) list = list.filter((a) => a.projectId === projectId)
  return list.slice(0, Math.min(200, Math.max(1, limit)))
}

module.exports = { logActivity, listActivity }
