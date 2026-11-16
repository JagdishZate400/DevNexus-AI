require('./helpers/offline')
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-32-chars-long!!'

// Mailer transport selection: console mode must never attempt SMTP, and a
// dead Ethereal API in development must degrade to console (never 502).
test('console mode uses console fallback even with SMTP creds present', async () => {
  process.env.SMTP_MODE = 'console'
  process.env.SMTP_HOST = 'smtp.gmail.com'
  process.env.SMTP_USER = 'your@gmail.com'
  process.env.SMTP_PASS = 'your-16-char-app-password'
  delete require.cache[require.resolve('../src/services/mailer')]
  const mailer = require('../src/services/mailer')
  mailer._resetTransporter()
  mailer.logEmailStatus = async () => {}
  const result = await mailer.sendVerificationEmail('console-check@example.com', '123456')
  assert.equal(result.delivery, 'console')
  assert.equal(mailer.getDeliveryMode(), 'console')
})

test('ethereal failure in development falls back to console', async () => {
  process.env.SMTP_MODE = 'ethereal'
  process.env.SMTP_HOST = ''
  process.env.SMTP_USER = ''
  process.env.SMTP_PASS = ''
  delete require.cache[require.resolve('../src/services/mailer')]
  const nodemailer = require('nodemailer')
  const original = nodemailer.createTestAccount
  nodemailer.createTestAccount = async () => { throw new Error('offline') }
  try {
    const mailer = require('../src/services/mailer')
    mailer._resetTransporter()
    mailer.logEmailStatus = async () => {}
    const result = await mailer.sendVerificationEmail('offline-dev@example.com', '123456')
    assert.equal(result.delivery, 'console')
  } finally {
    nodemailer.createTestAccount = original
  }
})

beforeEach(() => {
  process.env.SMTP_MODE = 'console'
  process.env.SMTP_HOST = ''
  process.env.SMTP_USER = ''
  process.env.SMTP_PASS = ''
})
