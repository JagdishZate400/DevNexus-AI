const config = require('../config')
const { analyzeSource, API_VERSION, safeDiagnostic } = require('./gemini')
const { validateReviewSource } = require('./reviewSource')
const transient = new Set(['ai_timeout', 'ai_quota', 'ai_unavailable'])
function createReviewBatchWorker({ batches, sources, analyze = analyzeSource, configuration = config, diagnostic = (entry) => console.warn(JSON.stringify(entry)) }) {
  let stopped = true, timer, active
  const contexts = new WeakMap()
  function emit(job, event, phase, errorCategory, details = {}) {
    const context = contexts.get(job)
    safeDiagnostic(diagnostic, { batchId: job.batch_id, fileId: job.file_id, attempt: job.attempt,
      event, phase, elapsedMs: Date.now() - context.started, httpStatus: context.httpStatus,
      errorCategory, diagnosticCategory: details.diagnosticCategory || errorCategory,
      apiVersion: API_VERSION, model: /^[a-zA-Z0-9._-]{1,200}$/.test(job.model) ? job.model : '[invalid model]', requestBytes: context.requestBytes })
  }
  async function finalize(job, outcome, phase) {
    let accepted
    try { accepted = await batches.finish(job, outcome) }
    catch (err) { emit(job, 'persistence_failed', phase, 'review_failed', { diagnosticCategory: 'persistence_error' }); throw err }
    if (accepted === false) {
      emit(job, 'completion_rejected', phase, 'stale_or_rejected_completion')
      return false // Do not retry finalization or overwrite the current claim holder.
    }
    emit(job, 'persistence_completed', phase, outcome.code || 'ok', { diagnosticCategory: 'completion_accepted' })
    return true
  }
  async function runOnce() {
    const job = await batches.claim()
    if (!job) return false
    contexts.set(job, { started: Date.now(), httpStatus: null, requestBytes: 0 })
    emit(job, 'attempt_started', 'attempt_started', 'ok')
    let file, phase = 'source_validation'
    try {
      const project = await sources.findProject(job.projectId, job.ownerId)
      if (!project) return await finalize(job, { code: 'ownership_unavailable', skipped: true }, 'ownership_check')
      file = await sources.readFile(job.projectId, job.file_id, job.ownerId)
      if (!file) return await finalize(job, { code: 'source_missing', skipped: true }, 'source_loading')
      const source = validateReviewSource(file)
      if (source.sourceHash !== job.source_sha256 || source.path !== job.path || source.bytes !== job.byte_count || source.lines !== job.line_count) {
        return await finalize(job, { code: 'source_changed', skipped: true }, 'source_validation')
      }
      if (configuration.aiProvider !== 'gemini' || configuration.geminiModel !== job.model) {
        return await finalize(job, { code: 'ai_configuration' }, 'configuration_check')
      }
      phase = 'child_creation'
      const reviewId = await batches.attachReview(job)
      if (!reviewId) return await finalize(job, { code: 'source_changed_or_unavailable', skipped: true }, 'child_creation')
      phase = 'generation'
      const findings = await analyze({ code: file.content, language: file.language.toLowerCase(), file: file.path, focus: job.options.focus, analysisFocus: job.options.analysisFocus,
        diagnostic: (entry) => {
          const context = contexts.get(job)
          context.httpStatus = Number.isInteger(entry.httpStatus) && entry.httpStatus >= 100 && entry.httpStatus <= 599 ? entry.httpStatus : null
          context.requestBytes = Number.isSafeInteger(entry.requestBytes) && entry.requestBytes >= 0 ? entry.requestBytes : 0
          const categories = new Set(['ok','ai_timeout','ai_quota','ai_unavailable','ai_configuration','ai_authentication','ai_model_unavailable','ai_request_rejected','ai_malformed_response','ai_blocked','ai_output_limit'])
          const reasons = new Set(['generation_success','gemini_timeout','programming_error','model_output_malformed','findings_validation_failure','response_stream_interrupted','network_fetch_failure','unexpected_adapter_error'])
          const category = categories.has(entry.category) ? entry.category : 'review_failed'
          const reason = reasons.has(entry.diagnosticCategory) || /^http_[1-5][0-9]{2}$/.test(entry.diagnosticCategory) || categories.has(entry.diagnosticCategory) ? entry.diagnosticCategory : 'unexpected_adapter_error'
          const validation = entry.phase === 'findings_validation'
          emit(job, validation ? 'findings_validation_failed' : category === 'ok' ? 'generation_completed' : 'generation_failed', ['request_preparation','fetch','http_response','response_stream','response_validation','generation_completed','findings_validation'].includes(entry.phase) ? entry.phase : 'generation', category, { diagnosticCategory: reason })
        },
      })
      phase = 'success_finalization'
      return await finalize(job, { findings, content: file.content }, 'success_finalization')
    } catch (err) {
      if (phase === 'child_creation') emit(job, 'persistence_failed', phase, 'review_failed', { diagnosticCategory: 'persistence_error' })
      // Only allowlisted categories are persisted; never raw database/provider messages.
      const code = ['source_integrity', 'unsupported_file', 'source_limit', 'unsafe_path', 'sensitive_file', 'binary_file', 'sensitive_content'].includes(err.code) ? err.code
        : ['ai_timeout', 'ai_quota', 'ai_unavailable', 'ai_configuration', 'ai_authentication', 'ai_model_unavailable', 'ai_request_rejected', 'ai_malformed_response', 'ai_blocked', 'ai_output_limit'].includes(err.code) ? err.code : 'review_failed'
      return await finalize(job, { code, skipped: !code.startsWith('ai_') && code !== 'review_failed', retry: transient.has(code), content: file?.content, retryAfterSeconds: err.retryAfterSeconds }, 'error_finalization')
    }
  }
  async function tick() {
    if (stopped) return
    try { active = runOnce(); await active } catch { console.error('[review-batches] Storage unavailable; leased work will recover. No raw error logged.') }
    finally {
      active = null
      if (!stopped) { timer = setTimeout(tick, 5000); timer.unref() }
    }
  }
  return {
    runOnce,
    start() { if (!stopped) return; stopped = false; timer = setTimeout(tick, 0); timer.unref() },
    async stop() { stopped = true; clearTimeout(timer); if (active) await active },
  }
}
module.exports = { createReviewBatchWorker, transient }
