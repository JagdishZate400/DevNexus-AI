const crypto = require('crypto')
const { Router } = require('express')
const { body, param, query } = require('express-validator')
const { projects } = require('../db/memory')
const { authRequired } = require('../middleware/auth')
const { canManageShared } = require('../middleware/rbac')
const { validate, paginate, asyncHandler } = require('../middleware/http')
const { logActivity } = require('../services/activity')
const {
  DEMO_PROJECTS,
  isDemoProjectId,
  getDemoProject,
  filterDemoProjects,
} = require('../fixtures/demoProjects')

const router = Router()
router.use(authRequired)

const STATUSES = ['Active', 'Archived', 'Analysis Complete']

function isOwnerOrManager(req, project) {
  if (!project) return false
  if (canManageShared(req)) return true
  const email = String(req.user.email || '').toLowerCase()
  const userId = req.user.sub || req.user.id
  if (project.ownerId && userId && project.ownerId === userId) return true
  return String(project.ownerEmail || project.owner || '').toLowerCase() === email
}

function isProjectOwner(req, project) {
  if (!project || !req.user) return false
  const userId = req.user.sub || req.user.id
  if (project.ownerId && userId && String(project.ownerId) === String(userId)) return true
  const email = String(req.user.email || '').toLowerCase().trim()
  const projectEmail = String(project.ownerEmail || project.owner || '').toLowerCase().trim()
  if (email && projectEmail && email === projectEmail) return true
  return false
}

function getRepository(req) {
  if (req.app?.locals?.projectRepository) return req.app.locals.projectRepository
  try {
    if (process.env.DATABASE_URL) {
      const pool = require('../db/postgres')
      return require('../db/projectRepository').createProjectRepository(pool)
    }
  } catch {
    // Offline or DB not configured
  }
  return null
}

router.get(
  '/',
  [
    query('search').optional().isString().isLength({ max: 120 }),
    query('status').optional().isIn(STATUSES),
    query('sort').optional().isIn(['updated', 'name', 'created', 'progress']),
    query('page').optional().isInt({ min: 1, max: 1000 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { search, status, sort } = req.query
    const safeDemos = filterDemoProjects({ search, status })

    const repo = getRepository(req)
    if (repo) {
      const result = await repo.list({
        userId: req.user.sub,
        canManageAll: canManageShared(req),
        search,
        status,
        sort,
        page: req.query.page,
        limit: req.query.limit,
      })

      const realProjects = result.projects.map((p) => ({ ...p, isDemo: false }))
      const realIds = new Set(realProjects.map((p) => p.id))
      const deduplicatedDemos = safeDemos.filter((d) => !realIds.has(d.id))

      return res.json({
        projects: realProjects,
        demoProjects: deduplicatedDemos,
        pagination: result.pagination,
      })
    }

    let list = [...projects]
    if (!canManageShared(req)) {
      list = list.filter((p) => isProjectOwner(req, p) || isDemoProjectId(p.id))
    }
    if (status) list = list.filter((p) => p.status === status)
    if (search) {
      const q = String(search).toLowerCase()
      list = list.filter(
        (p) =>
          String(p.name || '').toLowerCase().includes(q) ||
          String(p.description || '').toLowerCase().includes(q) ||
          (p.stack || []).some((s) => String(s).toLowerCase().includes(q))
      )
    }
    if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)))
    else if (sort === 'progress') list.sort((a, b) => (b.progress || 0) - (a.progress || 0))
    // default: newest first (unshift order) — no reorder needed for updated/created
    const { data, pagination } = paginate(list, req)
    return res.json({ projects: data, demoProjects: safeDemos, pagination })
  })
)

router.post(
  '/',
  [
    body('name').trim().isLength({ min: 1 }).withMessage('Name is required.').isLength({ max: 120 }),
    body('description').trim().isLength({ min: 1 }).withMessage('Description is required.').isLength({ max: 2000 }),
    body('stack').optional().isArray({ max: 20 }).withMessage('Stack must be an array.'),
    body('stack.*').optional().isString().isLength({ max: 40 }),
    body('status').optional().isIn(STATUSES).withMessage('Invalid status.'),
    body('progress').optional().isInt({ min: 0, max: 100 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, description, stack = [], status = 'Active', progress = 0 } = req.body
    if (req.body.id && isDemoProjectId(req.body.id)) {
      return res.status(409).json({ message: 'Project ID is reserved for predefined demo projects', code: 'reserved_id' })
    }

    const repo = getRepository(req)
    let project

    if (repo) {
      project = await repo.create({
        name,
        description,
        stack,
        status,
        progress,
        ownerId: req.user.sub,
      })
      project.isDemo = false
    } else {
      project = {
        id: `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`,
        name,
        description,
        stack: stack.map(String).slice(0, 20),
        status,
        owner: req.user.email,
        ownerEmail: req.user.email,
        ownerId: req.user.sub,
        teamSize: 1,
        updated: 'Just now',
        updatedAt: new Date().toISOString(),
        created: new Date().toDateString(),
        createdAt: new Date().toISOString(),
        progress,
        isDemo: false,
      }
      projects.unshift(project)
    }

    logActivity({
      type: 'project',
      message: `Project created: ${project.name}`,
      actorEmail: req.user.email,
      projectId: project.id,
    })
    return res.status(201).json({ project })
  })
)

router.get(
  '/:id',
  [param('id').trim().isLength({ min: 1, max: 160 })],
  validate,
  asyncHandler(async (req, res) => {
    const repo = getRepository(req)
    if (repo) {
      const project = await repo.findById(req.params.id, {
        userId: req.user.sub,
        canManageAll: canManageShared(req),
      })
      if (project) return res.json({ project: { ...project, isDemo: false } })

      // Check predefined demo fixtures
      const demo = getDemoProject(req.params.id)
      if (demo) return res.json({ project: { ...demo, isDemo: true } })

      return res.status(404).json({ message: 'Project not found', code: 'not_found' })
    }

    const project = projects.find((p) => p.id === req.params.id)
    if (project) {
      if (!canManageShared(req) && !isProjectOwner(req, project) && !isDemoProjectId(project.id)) {
        return res.status(404).json({ message: 'Project not found', code: 'not_found' })
      }
      const isDemo = isDemoProjectId(project.id)
      return res.json({ project: { ...project, isDemo } })
    }

    const demo = getDemoProject(req.params.id)
    if (demo) return res.json({ project: { ...demo, isDemo: true } })

    return res.status(404).json({ message: 'Project not found', code: 'not_found' })
  })
)

const updateValidators = [
  param('id').trim().isLength({ min: 1, max: 160 }),
  body('name').optional().trim().isLength({ min: 1, max: 120 }),
  body('description').optional().trim().isLength({ min: 1, max: 2000 }),
  body('stack').optional().isArray({ max: 20 }),
  body('stack.*').optional().isString().isLength({ max: 40 }),
  body('status').optional().isIn(STATUSES).withMessage('Invalid status.'),
  body('progress').optional().isInt({ min: 0, max: 100 }),
]

async function applyUpdate(req, res) {
  if (isDemoProjectId(req.params.id)) {
    return res.status(403).json({
      message: 'Predefined demo projects cannot be modified',
      code: 'demo_immutable',
    })
  }

  const repo = getRepository(req)
  if (repo) {
    try {
      const project = await repo.update(
        req.params.id,
        req.body,
        { userId: req.user.sub, canManageAll: canManageShared(req) }
      )
      logActivity({
        type: 'project',
        message: `Project updated: ${project.name}`,
        actorEmail: req.user.email,
        projectId: project.id,
      })
      return res.json({ project: { ...project, isDemo: false } })
    } catch (err) {
      if (err.code === 'not_found' || err.status === 404) {
        return res.status(404).json({ message: 'Project not found', code: 'not_found' })
      }
      if (err.code === 'forbidden' || err.status === 403) {
        return res.status(403).json({ message: 'Only the project owner or a lead can edit this project', code: 'forbidden' })
      }
      throw err
    }
  }

  const project = projects.find((p) => p.id === req.params.id)
  if (!project) return res.status(404).json({ message: 'Project not found', code: 'not_found' })
  if (!isOwnerOrManager(req, project)) {
    return res.status(403).json({ message: 'Only the project owner or a lead can edit this project', code: 'forbidden' })
  }
  const { name, description, stack, status, progress } = req.body
  if (name !== undefined) project.name = name
  if (description !== undefined) project.description = description
  if (stack !== undefined) project.stack = stack.map(String).slice(0, 20)
  if (status !== undefined) project.status = status
  if (progress !== undefined) project.progress = progress
  project.updated = 'Just now'
  project.updatedAt = new Date().toISOString()
  logActivity({
    type: 'project',
    message: `Project updated: ${project.name}`,
    actorEmail: req.user.email,
    projectId: project.id,
  })
  return res.json({ project })
}

router.patch('/:id', updateValidators, validate, asyncHandler(applyUpdate))
router.put('/:id', updateValidators, validate, asyncHandler(applyUpdate))

router.delete(
  '/:id',
  [param('id').trim().isLength({ min: 1, max: 160 })],
  validate,
  asyncHandler(async (req, res) => {
    if (isDemoProjectId(req.params.id)) {
      return res.status(403).json({
        message: 'Predefined demo projects cannot be deleted',
        code: 'demo_immutable',
      })
    }

    const repo = getRepository(req)
    if (repo) {
      let removed
      try {
        removed = await repo.delete(req.params.id, {
          userId: req.user.sub,
        })
      } catch (err) {
        if (err.code === 'not_found' || err.status === 404) {
          return res.status(404).json({ message: 'Project not found', code: 'not_found' })
        }
        if (err.code === 'forbidden' || err.status === 403) {
          return res.status(403).json({ message: 'Only the project owner can delete this project', code: 'forbidden' })
        }
        throw err
      }

      // Also clean up from memory cache if present
      const memIdx = projects.findIndex((p) => p.id === req.params.id)
      if (memIdx >= 0) projects.splice(memIdx, 1)

      // Clean up uploaded storage
      if (req.app.locals.sourceRepository || req.app.locals.runtimeSourceStorage) {
        try {
          const repository = req.app.locals.sourceRepository || require('../db/sourceRepository').createSourceRepository(require('../db/postgres'))
          await repository.removeProject(req.params.id, req.user.sub)
        } catch (err) {
          if (err.code !== '42P01') return res.status(503).json({ code: 'source_storage_unavailable', message: 'Could not delete project source storage.' })
        }
      }

      logActivity({
        type: 'project',
        message: `Project deleted: ${removed.name}`,
        actorEmail: req.user.email,
        projectId: removed.id,
      })
      return res.status(204).end()
    }

    const index = projects.findIndex((p) => p.id === req.params.id)
    if (index < 0) return res.status(404).json({ message: 'Project not found', code: 'not_found' })
    if (!isProjectOwner(req, projects[index])) {
      return res.status(403).json({ message: 'Only the project owner can delete this project', code: 'forbidden' })
    }
    if (req.app.locals.sourceRepository || req.app.locals.runtimeSourceStorage) {
      try {
        const repository = req.app.locals.sourceRepository || require('../db/sourceRepository').createSourceRepository(require('../db/postgres'))
        await repository.removeProject(req.params.id, req.user.sub)
      } catch (err) {
        if (err.code !== '42P01') return res.status(503).json({ code: 'source_storage_unavailable', message: 'Could not delete project source storage.' })
      }
    }
    const currentIndex = projects.findIndex((p) => p.id === req.params.id)
    if (currentIndex < 0) return res.status(404).json({ message: 'Project not found', code: 'not_found' })
    const [removed] = projects.splice(currentIndex, 1)
    logActivity({
      type: 'project',
      message: `Project deleted: ${removed.name}`,
      actorEmail: req.user.email,
      projectId: removed.id,
    })
    return res.status(204).end()
  })
)

function slugify(value) {
  return String(value || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

module.exports = router
