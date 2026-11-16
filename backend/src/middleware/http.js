const { validationResult } = require('express-validator')
const crypto = require('crypto')

function validate(req, res, next) {
  const result = validationResult(req)
  if (result.isEmpty()) return next()
  return res.status(400).json({
    message: 'Validation failed',
    errors: result.array().map((e) => ({ field: e.path, message: e.msg })),
  })
}

// Adds X-Request-Id to every response (echoes inbound value when present).
function requestId(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '').slice(0, 128)
  const id = incoming || crypto.randomUUID()
  req.requestId = id
  res.set('X-Request-Id', id)
  return next()
}

// Wraps async route handlers so rejections reach the error handler.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

// Consistent pagination: ?page=1&limit=20 (limit capped at 100).
function paginate(list, req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20))
  const total = list.length
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * limit
  return {
    data: list.slice(start, start + limit),
    pagination: { page: safePage, limit, total, totalPages },
  }
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500
  const isProd = process.env.NODE_ENV === 'production'
  // Never leak stack traces in production.
  return res.status(status).json({
    message: status >= 500 && isProd && !err.code?.startsWith('ai_') ? 'Internal server error' : err.message || 'Internal server error',
    code: err.code || (status >= 500 ? 'internal_error' : 'request_error'),
    requestId: req.requestId || res.get('X-Request-Id') || undefined,
  })
}

function notFound(req, res) {
  return res.status(404).json({ message: 'Not found', code: 'not_found' })
}

module.exports = { validate, errorHandler, notFound, requestId, asyncHandler, paginate }
