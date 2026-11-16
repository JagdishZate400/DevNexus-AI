// Usage: node scripts/test-mail.js you@example.com
// Sends a test verification email using backend/.env SMTP_* settings.
require('dotenv').config()
const config = require('../src/config')
const mailer = require('../src/services/mailer')

async function main() {
  const to = process.argv[2]
  if (!to || !to.includes('@')) {
    console.error('Usage: node scripts/test-mail.js you@example.com')
    process.exit(1)
  }
  console.log(`SMTP host: ${config.smtpHost || '(empty)'}`)
  console.log(`SMTP user: ${config.smtpUser || '(empty)'}`)
  console.log(`SMTP pass: ${config.smtpPass ? '***set***' : '(empty)'}`)
  console.log(`From: ${config.emailFrom}`)
  if (!mailer.isEmailConfigured()) {
    console.error('\nSMTP is NOT configured. Add this to backend/.env and restart:')
    console.error('SMTP_HOST=smtp.gmail.com')
    console.error('SMTP_PORT=587')
    console.error('SMTP_SECURE=false')
    console.error('SMTP_USER=you@gmail.com')
    console.error('SMTP_PASS=<16-char App Password>')
    console.error('EMAIL_FROM=AI Engineer <you@gmail.com>')
    process.exit(1)
  }
  const verify = await mailer.verifySmtpConnection()
  if (!verify.ok) {
    console.error(`\nSMTP verify failed: ${verify.reason}`)
    console.error('Common fixes: wrong App Password (Gmail needs App Password, not login), wrong port (587 + SECURE=false), or blocked network.')
    process.exit(1)
  }
  console.log('SMTP connection verified. Sending test mail...')
  await mailer.sendVerificationEmail(to, '123456', { expiresMinutes: 10 })
  console.log(`Test verification email sent to ${to}. Check inbox + spam.`)
}

main().catch((err) => {
  console.error(`Failed to send test mail: ${err.message}`)
  if (err.code === 'EAUTH') console.error('Auth failed — check SMTP_USER / SMTP_PASS (Gmail: use App Password).')
  if (err.code === 'ESOCKET' || err.code === 'ETIMEDOUT') console.error('Connection failed — check SMTP_HOST / SMTP_PORT and network/firewall.')
  process.exit(1)
})
