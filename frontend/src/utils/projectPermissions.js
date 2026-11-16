export const MANAGER_ROLES = Object.freeze(['Team Lead', 'Project Manager'])

export function isManagerRole(role) {
  return typeof role === 'string' && MANAGER_ROLES.includes(role)
}

export function isProjectOwner(user, project) {
  if (!user || !project) return false
  const userEmail = String(user.email || '').toLowerCase().trim()
  const projectOwnerEmail = String(project.ownerEmail || '').toLowerCase().trim()
  const projectOwner = String(project.owner || '').toLowerCase().trim()
  const userName = String(user.name || user.fullName || '').toLowerCase().trim()
  const userId = user.id ? String(user.id).trim() : ''
  const projectOwnerId = project.ownerId ? String(project.ownerId).trim() : ''

  if (userId && projectOwnerId && userId === projectOwnerId) return true
  if (userEmail && (userEmail === projectOwnerEmail || userEmail === projectOwner)) return true

  const userPrefix = userEmail ? userEmail.split('@')[0] : ''
  if (userPrefix && userPrefix === projectOwner) return true

  if (userName && (userName === projectOwner || projectOwner === 'you')) return true
  return false
}

export function canManageProject(user, project) {
  if (!user || !project) return false
  if (isManagerRole(user.role)) return true
  return isProjectOwner(user, project)
}

export function canDeleteProject(user, project) {
  if (!user || !project || project.isDemo) return false
  return isProjectOwner(user, project)
}
