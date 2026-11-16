const MANAGER_ROLES = new Set(['Team Lead', 'Project Manager'])

const PERMISSIONS = {
  'project:read': ['Developer', 'Team Lead', 'Project Manager'],
  'project:create': ['Developer', 'Team Lead', 'Project Manager'],
  'project:update': ['Team Lead', 'Project Manager'],
  'project:delete': ['Project Manager'],
  'task:read': ['Developer', 'Team Lead', 'Project Manager'],
  'task:create': ['Developer', 'Team Lead', 'Project Manager'],
  'task:update': ['Developer', 'Team Lead', 'Project Manager'],
  'task:delete': ['Team Lead', 'Project Manager'],
  'team:read': ['Developer', 'Team Lead', 'Project Manager'],
  'team:invite': ['Team Lead', 'Project Manager'],
  'team:remove': ['Project Manager'],
  'member:role:update': ['Team Lead', 'Project Manager'],
  'security:read': ['Team Lead', 'Project Manager'],
  'security:analyze': ['Team Lead', 'Project Manager'],
  'security:update': ['Team Lead', 'Project Manager'],
  'report:read': ['Developer', 'Team Lead', 'Project Manager'],
  'report:generate': ['Team Lead', 'Project Manager'],
  'user:read': ['Team Lead', 'Project Manager'],
  'user:role:update': ['Team Lead', 'Project Manager'],
}

function requireRole(...allowed) {
  const set = new Set(allowed)
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Missing bearer token', code: 'unauthorized' })
    if (set.size === 0 || set.has(req.user.role)) return next()
    return res.status(403).json({ message: 'Insufficient permissions', code: 'forbidden' })
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Missing bearer token', code: 'unauthorized' })
    const allowedRoles = PERMISSIONS[permission]
    if (!allowedRoles) {
      return res.status(500).json({ message: 'Unknown permission', code: 'internal_error' })
    }
    if (allowedRoles.includes(req.user.role)) return next()
    return res.status(403).json({ message: 'Insufficient permissions', code: 'forbidden' })
  }
}

function canManageShared(req) {
  return MANAGER_ROLES.has(req.user && req.user.role)
}

function canAccessResource(req, resourceOwnerId) {
  if (!req.user) return false
  if (MANAGER_ROLES.has(req.user.role)) return true
  return resourceOwnerId === req.user.sub
}

function hasPermission(role, permission) {
  const allowedRoles = PERMISSIONS[permission]
  if (!allowedRoles) return false
  return allowedRoles.includes(role)
}

module.exports = {
  requireRole,
  requirePermission,
  canManageShared,
  canAccessResource,
  hasPermission,
  PERMISSIONS,
  MANAGER_ROLES,
}
