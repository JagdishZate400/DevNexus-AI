// Run before config imports: tests must neither read .env nor use dev services.
require('dotenv').config = () => ({ parsed: {} })
for (const key of ['AI_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_TIMEOUT_MS', 'DATABASE_URL', 'AI_SERVICE_URL', 'OPENROUTER_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) delete process.env[key]
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'offline-test-secret-at-least-32-characters'
process.env.DEMO_VERIFICATION_CODE = '123456'
process.env.SMTP_MODE = 'console'
