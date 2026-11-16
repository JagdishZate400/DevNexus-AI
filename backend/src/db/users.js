
const pool = require('./postgres')

function toIsoString(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function versionGuard(expectedTokenVersion) {
  // Omission preserves existing callers; supplied versions enable compare-and-swap.
  if (expectedTokenVersion === undefined) return null
  if (!Number.isInteger(expectedTokenVersion) || expectedTokenVersion < 0 || expectedTokenVersion > 2147483647) {
    throw new TypeError('Expected token version must be a non-negative PostgreSQL integer')
  }
  return expectedTokenVersion
}

function mapUser(row) {
  if (!row) return null

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    passwordHash: row.password_hash,
    tokenVersion: row.token_version,
    createdAt: toIsoString(row.created_at),
  }
}

async function findByEmail(email) {
  const result = await pool.query(
    `SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  )

  return mapUser(result.rows[0])
}

async function findById(id) {
  const result = await pool.query(
    `SELECT * FROM users WHERE id = $1 LIMIT 1`,
    [id]
  )

  return mapUser(result.rows[0])
}

async function createUser(user) {
  const result = await pool.query(
    `INSERT INTO users
      (id, full_name, email, role, password_hash, token_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      user.id,
      user.fullName,
      user.email,
      user.role,
      user.passwordHash,
      user.tokenVersion ?? 0,
      user.createdAt ?? new Date(),
    ]
  )

  return mapUser(result.rows[0])
}

// Insert-only demo seeding: an email conflict returns null and never changes
// an existing account. Requires the schema's unique LOWER(email) index.
// Other failures (including ID conflicts) propagate to the caller.
async function createDemoUserIfAbsent(user) {
  const result = await pool.query(
    `INSERT INTO users
      (id, full_name, email, role, password_hash, token_version, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (LOWER(email)) DO NOTHING
     RETURNING *`,
    [
      user.id,
      user.fullName,
      user.email,
      user.role,
      user.passwordHash,
      user.tokenVersion ?? 0,
      user.createdAt ?? new Date(),
    ]
  )

  return mapUser(result.rows[0])
}

// With an expected version, null means a missing user or a version conflict.
// Callers must handle null before issuing credentials or reporting success.
async function updatePassword(userId, passwordHash, expectedTokenVersion) {
  const result = await pool.query(
    `UPDATE users
     SET password_hash = $1,
         token_version = token_version + 1
     WHERE id = $2 AND ($3::integer IS NULL OR token_version = $3::integer)
     RETURNING *`,
    [passwordHash, userId, versionGuard(expectedTokenVersion)]
  )

  return mapUser(result.rows[0])
}

// Same optional compare-and-swap contract as updatePassword.
async function updateRole(userId, role, expectedTokenVersion) {
  const result = await pool.query(
    `UPDATE users
     SET role = $1,
         token_version = token_version + 1
     WHERE id = $2 AND ($3::integer IS NULL OR token_version = $3::integer)
     RETURNING *`,
    [role, userId, versionGuard(expectedTokenVersion)]
  )

  return mapUser(result.rows[0])
}

async function listUsers() {
  const result = await pool.query(
    `SELECT id, full_name, email, role, created_at
     FROM users
     ORDER BY created_at DESC`
  )

  return result.rows.map((row) => ({
    id: row.id,
    name: row.full_name,
    email: row.email,
    role: row.role,
    createdAt: toIsoString(row.created_at),
  }))
}

module.exports = {
  findByEmail,
  findById,
  createUser,
  createDemoUserIfAbsent,
  updatePassword,
  updateRole,
  listUsers,
}
