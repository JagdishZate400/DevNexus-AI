require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const config = require('../src/config')
const mailer = require('../src/services/mailer')

test('production without SMTP rejects delivery and never writes message content', async () => {
  const fs = require('fs')
  const originalAppend = fs.appendFileSync
  const previous = config.isProd
  let writes = 0
  fs.appendFileSync = () => { writes++ }
  config.isProd = true
  mailer._resetTransporter()
  try {
    await assert.rejects(mailer.sendPasswordResetEmail('synthetic@example.com', 'synthetic-reset-token'), error => error.code === 'email_unavailable' && error.status === 503)
    await assert.rejects(mailer.sendVerificationEmail('synthetic@example.com', '654321'), error => error.code === 'email_unavailable')
    assert.equal(writes, 0)
  } finally {
    config.isProd = previous
    fs.appendFileSync = originalAppend
    mailer._resetTransporter()
  }
})

test('development disabled delivery does not log recipient, code, subject or reset link', async () => {
  const previous = config.isProd
  const original = console.log
  const output = []
  config.isProd = false
  mailer._resetTransporter()
  console.log = (...args) => output.push(args.join(' '))
  try {
    assert.equal((await mailer.sendVerificationEmail('synthetic@example.com', '654321')).delivery, 'console')
    await mailer.sendPasswordResetEmail('synthetic@example.com', 'synthetic-reset-token')
    assert.doesNotMatch(output.join('\n'), /synthetic@example|654321|synthetic-reset-token|reset-password/)
  } finally { console.log = original; config.isProd = previous; mailer._resetTransporter() }
})
