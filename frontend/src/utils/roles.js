// Authorization helpers shared by route guards and role-gated UI.
// Mirrors the backend RBAC contract (see backend/src/middleware/rbac.js):
// only Team Leads and Project Managers manage membership and user roles.
export const MANAGER_ROLES = ['Team Lead', 'Project Manager']

export function isManagerRole(role) {
  return MANAGER_ROLES.includes(role)
}

export function canManageMembers(user) {
  return isManagerRole(user?.role)
}
