const crypto = require('crypto')

function formatRelative(date) {
  if (!date) return 'Recently'
  const ms = Date.now() - new Date(date).getTime()
  if (ms < 0) return 'Just now'
  if (ms < 60000) return 'Just now'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(date).toLocaleDateString()
}

function mapProjectRow(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    stack: Array.isArray(row.stack) ? row.stack : [],
    status: row.status || 'Active',
    progress: Number(row.progress) || 0,
    owner: row.owner || row.ownerEmail || 'You',
    ownerEmail: row.ownerEmail || null,
    ownerId: row.ownerId || null,
    teamSize: Number(row.teamSize) || 1,
    created: row.createdAt ? new Date(row.createdAt).toDateString() : new Date().toDateString(),
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updated: formatRelative(row.updatedAt),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString(),
  }
}

function slugify(value) {
  return String(value || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

function createProjectRepository(pool) {
  if (!pool) throw new Error('PostgreSQL pool is required to create projectRepository')

  return {
    async list({ userId, canManageAll = false, search, status, sort = 'updated', page = 1, limit = 50 }) {
      const pageNum = Math.max(1, parseInt(page, 10) || 1)
      const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 50))
      const offset = (pageNum - 1) * limitNum

      const whereClauses = []
      const params = []

      // Access control: Managers can see all; regular users see owned or memberships
      if (!canManageAll && userId) {
        params.push(userId)
        whereClauses.push(`(p.owner_id = $${params.length} OR EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = p.id AND pm.user_id = $${params.length}))`)
      }

      // Filter by status
      if (status) {
        params.push(status)
        whereClauses.push(`p.status = $${params.length}`)
      }

      // Search across name, description, and stack
      if (search && String(search).trim()) {
        params.push(`%${String(search).trim()}%`)
        const idx = params.length
        whereClauses.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx} OR array_to_string(p.stack, ' ') ILIKE $${idx})`)
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''

      // Sort order
      let orderSql = 'ORDER BY p.updated_at DESC, p.id DESC'
      if (sort === 'name') {
        orderSql = 'ORDER BY p.name ASC, p.id ASC'
      } else if (sort === 'progress') {
        orderSql = 'ORDER BY p.progress DESC, p.updated_at DESC, p.id DESC'
      } else if (sort === 'created') {
        orderSql = 'ORDER BY p.created_at DESC, p.id DESC'
      }

      const countSql = `SELECT count(*)::int AS total FROM source_projects p ${whereSql}`
      const totalResult = await pool.query(countSql, params)
      const total = totalResult.rows[0]?.total || 0

      const queryParams = [...params, limitNum, offset]
      const dataSql = `
        SELECT 
          p.id,
          p.name,
          p.description,
          p.stack,
          p.status,
          p.progress,
          p.created_at AS "createdAt",
          p.updated_at AS "updatedAt",
          p.owner_id AS "ownerId",
          u.email AS "ownerEmail",
          COALESCE(u.full_name, u.email) AS "owner",
          (SELECT count(DISTINCT pm.user_id) FROM project_memberships pm WHERE pm.project_id = p.id) + 1 AS "teamSize"
        FROM source_projects p
        JOIN users u ON u.id = p.owner_id
        ${whereSql}
        ${orderSql}
        LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}
      `

      const rowsResult = await pool.query(dataSql, queryParams)
      const projects = rowsResult.rows.map(mapProjectRow)
      const totalPages = Math.ceil(total / limitNum) || 1

      return {
        projects,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: totalPages,
          hasMore: pageNum < totalPages,
        },
      }
    },

    async findById(id, { userId, canManageAll = false } = {}) {
      if (!id) return null
      const sql = `
        SELECT 
          p.id,
          p.name,
          p.description,
          p.stack,
          p.status,
          p.progress,
          p.created_at AS "createdAt",
          p.updated_at AS "updatedAt",
          p.owner_id AS "ownerId",
          u.email AS "ownerEmail",
          COALESCE(u.full_name, u.email) AS "owner",
          (SELECT count(DISTINCT pm.user_id) FROM project_memberships pm WHERE pm.project_id = p.id) + 1 AS "teamSize"
        FROM source_projects p
        JOIN users u ON u.id = p.owner_id
        WHERE p.id = $1
      `
      const res = await pool.query(sql, [id])
      const row = res.rows[0]
      if (!row) return null

      // Check access permission
      if (!canManageAll && userId) {
        if (row.ownerId !== userId) {
          const memberCheck = await pool.query(
            'SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2',
            [id, userId]
          )
          if (memberCheck.rows.length === 0) {
            return null // forbidden/not accessible
          }
        }
      }

      return mapProjectRow(row)
    },

    async create({ name, description, stack = [], status = 'Active', progress = 0, ownerId, id = null }) {
      if (!ownerId) throw new Error('ownerId is required to create a project')
      const projectId = id || `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`
      const cleanStack = Array.isArray(stack) ? stack.map(String).slice(0, 20) : []
      const cleanProgress = Math.max(0, Math.min(100, parseInt(progress, 10) || 0))

      const insertSql = `
        INSERT INTO source_projects (id, owner_id, name, description, stack, status, progress, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now())
        RETURNING *
      `
      await pool.query(insertSql, [
        projectId,
        ownerId,
        name,
        description || '',
        cleanStack,
        status || 'Active',
        cleanProgress,
      ])

      return this.findById(projectId, { userId: ownerId, canManageAll: true })
    },

    async update(id, updates, { userId, canManageAll = false } = {}) {
      const existing = await this.findById(id, { canManageAll: true })
      if (!existing) {
        const error = new Error('Project not found')
        error.code = 'not_found'
        error.status = 404
        throw error
      }

      // Only owner or manager can edit
      if (!canManageAll && existing.ownerId !== userId) {
        const error = new Error('Only the project owner or a lead can edit this project')
        error.code = 'forbidden'
        error.status = 403
        throw error
      }

      const setClauses = ['updated_at = now()']
      const params = [id]

      if (updates.name !== undefined) {
        params.push(updates.name)
        setClauses.push(`name = $${params.length}`)
      }
      if (updates.description !== undefined) {
        params.push(updates.description)
        setClauses.push(`description = $${params.length}`)
      }
      if (updates.stack !== undefined) {
        const cleanStack = Array.isArray(updates.stack) ? updates.stack.map(String).slice(0, 20) : []
        params.push(cleanStack)
        setClauses.push(`stack = $${params.length}`)
      }
      if (updates.status !== undefined) {
        params.push(updates.status)
        setClauses.push(`status = $${params.length}`)
      }
      if (updates.progress !== undefined) {
        const cleanProgress = Math.max(0, Math.min(100, parseInt(updates.progress, 10) || 0))
        params.push(cleanProgress)
        setClauses.push(`progress = $${params.length}`)
      }

      const updateSql = `
        UPDATE source_projects
        SET ${setClauses.join(', ')}
        WHERE id = $1
      `
      await pool.query(updateSql, params)
      return this.findById(id, { userId, canManageAll: true })
    },

    async delete(id, { userId } = {}) {
      const existing = await this.findById(id, { canManageAll: true })
      if (!existing) {
        const error = new Error('Project not found')
        error.code = 'not_found'
        error.status = 404
        throw error
      }

      // Deletion is strictly restricted to the project owner
      if (existing.ownerId !== userId) {
        const error = new Error('Only the project owner can delete this project')
        error.code = 'forbidden'
        error.status = 403
        throw error
      }

      await pool.query('DELETE FROM source_projects WHERE id = $1', [id])
      return existing
    },
  }
}

module.exports = {
  createProjectRepository,
  formatRelative,
  mapProjectRow,
  slugify,
}
