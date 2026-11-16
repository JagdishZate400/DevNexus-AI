const cors = require('cors')
const express = require('express')
const helmet = require('helmet')
const morgan = require('morgan')
const rateLimit = require('express-rate-limit')
const config = require('./config')
const { errorHandler, notFound, requestId } = require('./middleware/http')
const mailer = require('./services/mailer')
const authRoutes = require('./routes/auth')
const projectRoutes = require('./routes/projects')
const securityRoutes = require('./routes/security')
const taskRoutes = require('./routes/tasks')
const sprintRoutes = require('./routes/sprints')
const teamRoutes = require('./routes/team')
const reviewRoutes = require('./routes/reviews')
const documentRoutes = require('./routes/documents')
const aiRoutes = require('./routes/ai')
const insightRoutes = require('./routes/insights')
const reportRoutes = require('./routes/reports')
const { openapiHandler } = require('./routes/openapi')
const { getProvider } = require('./services/ai')
const { router: workspaceRoutes } = require('./routes/workspace')

function createApp({ userRepository, projectRepository, sourceRepository, reviewRepository, reviewBatchRepository, documentRepository, documentEvidenceRepository, taskRepository, sprintRepository, membershipRepository, taskCommentRepository, taskActivityRepository, reportsRepository, conversationRepository, indexWorker } = {}) {
  const app = express()
  app.locals.userRepository = userRepository || require('./db/users')
  app.locals.projectRepository = projectRepository || null
  app.locals.sourceRepository = sourceRepository
  app.locals.reviewRepository = reviewRepository
  app.locals.reviewBatchRepository = reviewBatchRepository
  app.locals.documentRepository = documentRepository
  app.locals.documentEvidenceRepository = documentEvidenceRepository
  app.locals.taskRepository = taskRepository
  app.locals.sprintRepository = sprintRepository
  app.locals.membershipRepository = membershipRepository
  app.locals.taskCommentRepository = taskCommentRepository
  app.locals.taskActivityRepository = taskActivityRepository
  app.locals.reportsRepository = reportsRepository
  app.locals.indexWorker = indexWorker || null
  let pgPool = null
  try {
    if (process.env.DATABASE_URL) {
      pgPool = require('./db/postgres')
    }
  } catch {
    // Unconfigured or offline
  }
  const { createResilientConversationRepository } = require('./db/aiConversationRepository')
  const { conversations } = require('./db/memory')
  app.locals.conversationRepository = conversationRepository || createResilientConversationRepository(pgPool, conversations)
  app.locals.runtimeSourceStorage = !userRepository
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  // Mitigation for qs moderate CVEs (GHSA-x5fp-wj9c-mxmx, GHSA-4mjr-xmp4-gh2g):
  // use simple query parser so bracket/array parsing never hits qs.
  app.set('query parser', 'simple')

  app.use(requestId)
  app.use(helmet())
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow same-origin / curl (no Origin) and configured allowlist only.
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true)
        return cb(new Error('CORS blocked'))
      },
      credentials: false,
    })
  )
  // 100KB body cap mitigates large-payload DoS.
  app.use('/api/project-tasks/:taskId/comments', (req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  app.use('/api/project-tasks/:taskId/activity', (req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  app.use(express.json({ limit: '100kb' }))
  app.use('/api/project-tasks/:taskId/comments', (error, req, res, next) => {
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ code: 'invalid_request', message: 'Invalid task comment request.', requestId: req.requestId })
    }
    next(error)
  })
  app.use('/api/project-tasks/:taskId/activity', (error, req, res, next) => {
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      return res.status(error.type === 'entity.too.large' ? 413 : 400).json({ code: 'invalid_request', message: 'Invalid task activity request.', requestId: req.requestId })
    }
    next(error)
  })
  morgan.token('reqid', (req) => req.requestId || '-')
  app.use(morgan(config.isProd ? 'combined' : 'dev'))

  const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false })
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false })
  // Tight per-IP budgets on code endpoints: spraying codes across many
  // addresses is throttled even though each address also has its own cap.
  const codeRequestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many code requests. Try again later.' } })
  const codeVerifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many verification attempts. Try again later.' } })
  const passwordResetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many reset requests. Try again later.' } })
  const aiLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many AI requests. Slow down.' } })
  app.use('/api/', generalLimiter)
  app.use('/api/auth/', authLimiter)
  app.use('/api/auth/request-code', codeRequestLimiter)
  app.use('/api/auth/verify-code', codeVerifyLimiter)
  app.use('/api/auth/forgot-password', passwordResetLimiter)
  app.use('/api/auth/reset-password', passwordResetLimiter)
  app.use('/api/ai/', aiLimiter)
  app.use('/api/reviews/analyze', aiLimiter)

  app.get('/health', (req, res) =>
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      version: require('../package.json').version,
      persistence: userRepository ? 'explicit test repository' : 'postgres users; temporary memory tokens',
      ai: getProvider(),
    })
  )
  app.get('/api/openapi.json', openapiHandler)
  app.use('/api/auth', authRoutes)
  app.use('/api/projects', projectRoutes)
  app.use('/api/workspace', workspaceRoutes)
  app.use('/api/security', securityRoutes)
  app.use('/api/tasks', taskRoutes)
  app.use('/api/sprints', sprintRoutes)
  app.use('/api/team', teamRoutes)
  app.use('/api/reviews', reviewRoutes)
  app.use('/api/repository-reviews', require('./routes/repositoryReviews'))
  app.use('/api/repository-review-batches', require('./routes/repositoryReviewBatches'))
  app.use('/api/documents', documentRoutes)
  app.use('/api/project-documents', require('./routes/projectDocuments'))
  app.use('/api/project-tasks', require('./routes/projectTasks'))
  app.use('/api/project-sprints', require('./routes/projectSprints'))
  app.use('/api/project-members', require('./routes/projectMembers'))
  app.use('/api/ai', aiRoutes)
  app.use('/api/reports', reportRoutes)
  app.use('/api', insightRoutes)

  app.use(notFound)
  // CORS errors surface as 403 instead of leaking internals.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.message === 'CORS blocked') return res.status(403).json({ message: 'Forbidden' })
    return errorHandler(err, req, res, next)
  })

  // Demo seeding is intentionally not performed during app construction.
  // A future explicit startup step can use createDemoUserIfAbsent safely.
  mailer.logEmailStatus()
  if (config.aiProvider === 'gemini') {
    console.log('[ai] Gemini selected; connectivity not yet verified')
  } else if (config.aiServiceUrl) {
    // eslint-disable-next-line no-console
    console.log(`[ai] FastAPI RAG service configured at ${config.aiServiceUrl}`)
  } else if (config.openrouterApiKey) {
    // eslint-disable-next-line no-console
    console.log(`[ai] OpenRouter configured (model: ${config.openrouterModel})`)
  }
  return app
}

module.exports = { createApp }
