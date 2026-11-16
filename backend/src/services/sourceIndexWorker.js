const crypto = require('crypto')

function createSourceIndexWorker({ jobs, pollIntervalMs = 2000, leaseSeconds = 60 } = {}) {
  const workerId = crypto.randomUUID()
  let running = false
  let timer = null
  let activePromise = null

  async function step() {
    if (!running) return false
    try {
      const job = await jobs.claimJob(workerId, { leaseSeconds })
      if (!job) return false

      let hasMore = true
      while (hasMore && running) {
        // Renew lease before each batch
        await jobs.renewLease(job.id, workerId, { leaseSeconds })
        const batchResult = await jobs.processBatch(job, workerId)

        if (!batchResult.held) {
          // Lease was lost or stolen; stop processing this job
          break
        }

        hasMore = batchResult.hasMore
      }
      return true
    } catch (err) {
      console.error('[sourceIndexWorker] Batch execution failed:', err.message)
      return false
    }
  }

  async function loop() {
    if (!running) return
    const didWork = await step()
    if (running) {
      // If work was done, check for another job immediately; otherwise wait poll interval
      const delay = didWork ? 50 : pollIntervalMs
      timer = setTimeout(() => {
        activePromise = loop()
      }, delay)
    }
  }

  function start() {
    if (running) return
    running = true
    activePromise = loop()
  }

  async function stop() {
    running = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (activePromise) {
      try {
        await activePromise
      } catch {}
    }
  }

  function trigger() {
    if (!running) return
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    activePromise = loop()
  }

  return {
    workerId,
    start,
    stop,
    trigger,
    step, // Exposed for deterministic step-by-step testing
  }
}

module.exports = {
  createSourceIndexWorker,
}
