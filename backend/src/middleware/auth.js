const jwt = require('jsonwebtoken')
const config = require('../config')
const { userQuery } = require('../services/userRepository')

const JWT_ALGORITHM = 'HS256'
const JWT_ISSUER = 'ai-engineer-api'
const JWT_AUDIENCE = 'ai-engineer-app'

function signToken(user) {
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET is not configured')
  }
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, tv: user.tokenVersion ?? 0 },
    config.jwtSecret,
    {
      algorithm: JWT_ALGORITHM,
      expiresIn: config.jwtExpiresIn,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    }
  )
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  })
}

async function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Missing bearer token', code: 'unauthorized' })
  }
  let payload
  try {
    payload = verifyToken(token)
    if (typeof payload.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.sub)) {
      throw new Error('Invalid subject')
    }
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token', code: 'unauthorized' })
  }
  try {
    const user = await userQuery(req, 'findById', payload.sub)
    if (!user || (payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      return res.status(401).json({ message: 'Invalid or expired token', code: 'unauthorized' })
    }
    req.user = { ...payload, role: user.role, email: user.email }
    req.authUser = user
    return next()
  } catch (error) {
    return next(error)
  }
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return require('crypto').timingSafeEqual(bufA, bufB)
}

function authTimingSafe(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) {
    const dummy = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkdW1teSIsImVtYWlsIjoiZHVtbXlAZXhhbXBsZS5jb20iLCJyb2xlIjoiRGV2ZWxvcGVyIiwidHYiOjB9.dummy'
    try {
      verifyToken(dummy)
    } catch {
      // Expected to fail
    }
    return res.status(401).json({ message: 'Missing bearer token', code: 'unauthorized' })
  }
  return authRequired(req, res, next)
}

function requireOwnership(getOwnerId) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Missing bearer token', code: 'unauthorized' })
    const ownerId = getOwnerId(req)
    if (ownerId && ownerId !== req.user.sub && req.user.role !== 'Project Manager' && req.user.role !== 'Team Lead') {
      return res.status(403).json({ message: 'Insufficient permissions', code: 'forbidden' })
    }
    return next()
  }
}

function addSecurityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  next()
}

module.exports = {
  signToken,
  verifyToken,
  authRequired,
  authTimingSafe,
  requireOwnership,
  addSecurityHeaders,
  timingSafeEqual,
  JWT_ALGORITHM,
  JWT_ISSUER,
  JWT_AUDIENCE,
}
