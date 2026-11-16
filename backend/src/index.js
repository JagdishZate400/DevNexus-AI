
const config = require('./config')
const { createApp } = require('./app')
const pool = require('./db/postgres')

async function startServer() {
  const problems = []

  if (!config.jwtSecret) {
    problems.push('JWT_SECRET is not configured.')
  } else if (String(config.jwtSecret).length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters.')
  }

  if (!config.databaseUrl) {
    problems.push('DATABASE_URL is not configured.')
  }

  if (problems.length > 0) {
    console.error(`FATAL: ${problems.join(' ')}`)
    process.exitCode = 1
    return
  }

  try {
    const result = await pool.query(
      'SELECT current_database() AS database, current_user AS username'
    )

    console.log('[db] PostgreSQL connected:', result.rows[0])

    let indexWorker
    try {
      const { createSourceIndexJobsRepository } = require('./db/sourceIndexJobsRepository')
      const indexJobs = createSourceIndexJobsRepository(pool)
      if (await indexJobs.ready()) {
        const { createSourceIndexWorker } = require('./services/sourceIndexWorker')
        indexWorker = createSourceIndexWorker({ jobs: indexJobs })
        indexWorker.start()
        console.log('[source-index] Durable asynchronous indexing worker started.')
      }
    } catch (err) {
      console.warn('[source-index] Worker disabled:', err.message)
    }

    const app = createApp({ indexWorker })
    let batchWorker
    if (config.aiProvider === 'gemini') {
      try {
        const batches = require('./db/reviewBatchRepository').createReviewBatchRepository(pool)
        if (await batches.ready()) {
          batchWorker = require('./services/reviewBatchWorker').createReviewBatchWorker({ batches, sources: require('./db/sourceRepository').createSourceRepository(pool) })
          batchWorker.start()
          console.log('[review-batches] Durable worker started (one batch file at a time).')
        } else console.warn('[review-batches] Worker disabled: apply the D2.1 migration explicitly, then restart.')
      } catch { console.warn('[review-batches] Worker disabled: batch storage unavailable. Check migration/connectivity and restart.') }
    }

    const server = app.listen(config.port, () => {
      console.log(`Backend listening on http://localhost:${config.port}`)
    })

    let shuttingDown = false

    async function shutdown(signal) {
      if (shuttingDown) return
      shuttingDown = true

      console.log(`Received ${signal}, shutting down...`)

      const timeout = setTimeout(() => {
        console.error('Shutdown timed out')
        process.exit(1)
      }, 5000)
      timeout.unref()

      server.close(async () => {
        try {
          await indexWorker?.stop()
          await batchWorker?.stop()
          await pool.end()
          clearTimeout(timeout)
          process.exit(0)
        } catch (error) {
          console.error('Shutdown error:', error.message)
          process.exit(1)
        }
      })
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  } catch (error) {
    console.error('[db] PostgreSQL startup failed:', error.message)
    process.exitCode = 1
    await pool.end().catch(() => {})
  }
}

startServer()
