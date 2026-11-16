// Explicit async repository fixture. Never imports pg or the runtime repository.
function createTestRepository() {
  const users = new Map()
  const copy = (user) => user ? { ...user } : null
  return {
    async findByEmail(email) { return copy(users.get(String(email).toLowerCase())) },
    async findById(id) { return copy([...users.values()].find((u) => u.id === id)) },
    async createUser(user) {
      const key = user.email.toLowerCase()
      if (users.has(key)) {
        const error = new Error('Duplicate email')
        error.code = '23505'
        error.constraint = 'users_email_lower_unique'
        throw error
      }
      const row = { ...user, tokenVersion: user.tokenVersion ?? 0, createdAt: new Date(user.createdAt ?? Date.now()).toISOString() }
      users.set(key, row)
      return copy(row)
    },
    async updatePassword(id, passwordHash, expectedTokenVersion) {
      const row = [...users.values()].find((u) => u.id === id)
      if (!row || row.tokenVersion !== expectedTokenVersion) return null
      row.passwordHash = passwordHash
      row.tokenVersion++
      return copy(row)
    },
    async updateRole(id, role, expectedTokenVersion) {
      const row = [...users.values()].find((u) => u.id === id)
      if (!row || row.tokenVersion !== expectedTokenVersion) return null
      row.role = role
      row.tokenVersion++
      return copy(row)
    },
    async listUsers() {
      return [...users.values()].map((u) => ({ id: u.id, name: u.fullName, email: u.email, role: u.role, createdAt: u.createdAt }))
    },
  }
}
module.exports = { createTestRepository }
