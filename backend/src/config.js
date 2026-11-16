require('dotenv').config({ quiet: true })

function parseOrigins(value, fallback, isProd = process.env.NODE_ENV === 'production') {
  const raw = (value || fallback || '').split(',').map((s) => s.trim()).filter(Boolean)
  const origins = raw.length > 0 ? raw : ['http://localhost:5173']
  // Vite uses 5174 when 5173 is occupied. Exact local development origin only.
  return isProd ? origins : [...new Set([...origins, 'http://localhost:5174'])]
}

function parseGeminiModel(value) {
  const raw = String(value || '')
  let model = raw.trim()
  const whitespace = model !== raw || /[\s\u200B-\u200D\u2060]/u.test(model)
  const quotes = /^["']|["']$/.test(model)
  if ((model.startsWith('"') && model.endsWith('"')) || (model.startsWith("'") && model.endsWith("'"))) model = model.slice(1, -1).trim()
  const prefix = model.startsWith('models/')
  if (prefix) model = model.slice(7)
  // Embedded whitespace/invisible characters are rejected, not silently removed.
  return { model, whitespace, quotes, prefix, valid: /^[a-zA-Z0-9._-]+$/.test(model) }
}
const geminiModelInfo = parseGeminiModel(process.env.GEMINI_MODEL)

function parseGrokModel(value) {
  const raw = String(value || '')
  let model = raw.trim()
  const whitespace = model !== raw || /[\s\u200B-\u200D\u2060]/u.test(model)
  const quotes = /^["']|["']$/.test(model)
  if ((model.startsWith('"') && model.endsWith('"')) || (model.startsWith("'") && model.endsWith("'"))) {
    model = model.slice(1, -1).trim()
  }
  // Model identifier syntax validation: non-empty string of alphanumeric, dots, underscores, dashes, slashes.
  // We do not assume hardcoded models are necessarily available on live xAI endpoints without explicit operator configuration.
  const valid = Boolean(model) && /^[a-zA-Z0-9._/-]{1,120}$/.test(model) && !whitespace
  return {
    model: valid ? model : '',
    raw,
    valid,
    configured: Boolean(raw.trim()),
  }
}
const grokModelInfo = parseGrokModel(process.env.GROK_MODEL)

module.exports = {
  port: Number(process.env.PORT || 5000),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  corsOrigins: parseOrigins(process.env.CORS_ORIGIN, 'http://localhost:5173,http://localhost:4173'),
  isProd: process.env.NODE_ENV === 'production',
  // Login brute-force defense: lock an account after N failed attempts.
  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
  lockoutMinutes: Number(process.env.LOCKOUT_MINUTES || 15),
  // In-memory store. Replace with PostgreSQL in production (see README).
  demoEmail: process.env.DEMO_EMAIL || 'test@example.com',
  demoPassword: process.env.DEMO_PASSWORD || 'Password123!',
  // Outgoing mail (verification codes).
  // SMTP_MODE=ethereal → free Ethereal test inbox (dev).
  // SMTP_MODE=smtp + real SMTP_* → Gmail/Resend/SES delivery.
  // Placeholder Gmail values auto-fall back to Ethereal in non-production.
  smtpHost: String(process.env.SMTP_HOST || '').trim(),
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  smtpUser: String(process.env.SMTP_USER || '').trim(),
  smtpPass: String(process.env.SMTP_PASS || '').trim(),
  emailFrom: String(process.env.EMAIL_FROM || process.env.SMTP_USER || 'AI Engineer <no-reply@localhost>').trim(),
  appName: process.env.APP_NAME || 'AI Engineer',
  // Dev-only demo verification code (e.g. local demos without inbox access).
  // Defaults to '123456' outside production; ALWAYS ignored in production.
  // Set DEMO_VERIFICATION_CODE= (empty) to disable even in development.
  demoVerificationCode:
    process.env.DEMO_VERIFICATION_CODE ?? (process.env.NODE_ENV === 'production' ? '' : '123456'),
  // --- Production-readiness / integration knobs (all optional for local dev) ---
  // DATABASE_URL: when set, a future Prisma/pg layer can persist the in-memory
  // stores below. The app runs without it (memory store) so `npm test` stays offline.
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',
  // FastAPI AI service (RAG pipeline). When unset, /api/ai/* uses the built-in
  // mock responder so the UI works without the Python service.
  aiServiceUrl: (process.env.AI_SERVICE_URL || '').replace(/\/$/, ''),
  aiServiceTimeoutMs: Number(process.env.AI_SERVICE_TIMEOUT_MS || 15000),
  aiProvider: String(process.env.AI_PROVIDER || '').trim().toLowerCase(),
  aiMultiProviderChatEnabled: String(process.env.AI_MULTI_PROVIDER_CHAT_ENABLED || 'false').trim().toLowerCase() === 'true',
  // Grok credential precedence: GROK_API_KEY_1 (preferred primary) > GROK_API_KEY (legacy alias) > XAI_API_KEY (legacy alias)
  grokApiKey1: String(process.env.GROK_API_KEY_1 || process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim(),
  grokApiKey: String(process.env.GROK_API_KEY_1 || process.env.GROK_API_KEY || process.env.XAI_API_KEY || '').trim(),
  grokApiKey2: String(process.env.GROK_API_KEY_2 || '').trim(),
  grokApiKey3: String(process.env.GROK_API_KEY_3 || '').trim(),
  grokModel: grokModelInfo.model,
  grokModelInfo,
  grokTimeoutMs: Number(process.env.GROK_TIMEOUT_MS || 60000),
  geminiApiKey: String(process.env.GEMINI_API_KEY || '').trim(),
  geminiApiKey2: String(process.env.GEMINI_API_KEY_2 || '').trim(),
  geminiModel: geminiModelInfo.model,
  geminiModelInfo,
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 90000),
  // Direct LLM via OpenRouter (no Python service needed). The key lives only
  // server-side and is never exposed to the frontend. When both are set, the
  // FastAPI service wins; otherwise OpenRouter; otherwise the offline mock.
  openrouterApiKey: String(process.env.OPENROUTER_API_KEY || '').trim(),
  openrouterModel: String(process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini').trim(),
  openrouterTimeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS || 30000),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  // Opaque refresh-token + password-reset lifetimes.
  refreshTokenTtlMs: Number(process.env.REFRESH_TOKEN_TTL_HOURS || 24 * 7) * 60 * 60 * 1000,
  passwordResetTtlMs: Number(process.env.PASSWORD_RESET_MINUTES || 30) * 60 * 1000,
  // Workspace ZIP ingestion & capacity limits
  workspaceMaxArchiveBytes: Number(process.env.WORKSPACE_MAX_ARCHIVE_BYTES || 50 * 1024 * 1024),
  workspaceMaxProjectFiles: Number(process.env.WORKSPACE_MAX_PROJECT_FILES || 1000),
  workspaceMaxTotalBytes: Number(process.env.WORKSPACE_MAX_TOTAL_BYTES || 250 * 1024 * 1024),
  workspaceMaxFileBytes: Number(process.env.WORKSPACE_MAX_FILE_BYTES || 1024 * 1024),
  workspaceMaxEntries: Number(process.env.WORKSPACE_MAX_ENTRIES || 10000),
  workspaceMaxLines: Number(process.env.WORKSPACE_MAX_LINES || 25000),
  workspaceMaxExpansionRatio: Number(process.env.WORKSPACE_MAX_EXPANSION_RATIO || 25),
  workspaceExtractionTimeoutMs: Number(process.env.WORKSPACE_EXTRACTION_TIMEOUT_MS || 60000),
}

function assertProductionReady() {
  const problems = []
  if (!module.exports.jwtSecret) problems.push('JWT_SECRET is not set')
  else if (String(module.exports.jwtSecret).length < 32) problems.push('JWT_SECRET must be >= 32 characters')
  return problems
}

module.exports.assertProductionReady = assertProductionReady

module.exports.parseGeminiModel = parseGeminiModel

module.exports.parseOrigins = parseOrigins

module.exports.parseGrokModel = parseGrokModel
