const nodemailer = require('nodemailer')
const config = require('../config')
const { emailConfig, isEmailConfigured, hasPlaceholderSmtpCredentials } = require('../config/email.config')
const {
  verificationCodeTemplate,
  welcomeEmailTemplate,
  passwordResetTemplate,
} = require('../templates/emailTemplates')

let transporter = null
let transporterMode = null // 'smtp' | 'ethereal' | null
let etherealAccount = null
let initPromise = null

function isConsoleMode() {
  const mode = String(process.env.SMTP_MODE || '').toLowerCase().trim()
  return mode === 'console' || mode === 'off' || mode === 'none'
}

function shouldUseEthereal() {
  if (config.isProd) return false
  if (isConsoleMode()) return false
  const mode = String(process.env.SMTP_MODE || '').toLowerCase().trim()
  if (mode === 'ethereal' || mode === 'test') return true
  if (mode === 'smtp' || mode === 'gmail') return false
  // Auto: placeholders (your@gmail.com) or empty host → Ethereal in development.
  if (!config.smtpHost) return true
  return hasPlaceholderSmtpCredentials()
}

async function createEtherealTransport() {
  etherealAccount = await nodemailer.createTestAccount()
  const tx = nodemailer.createTransport({
    host: etherealAccount.smtp.host,
    port: etherealAccount.smtp.port,
    secure: etherealAccount.smtp.secure,
    auth: {
      user: etherealAccount.user,
      pass: etherealAccount.pass,
    },
  })
  transporter = tx
  transporterMode = 'ethereal'
  if (!config.isProd) {
    // eslint-disable-next-line no-console
    console.log('[MAILER] Ethereal test SMTP ready')
  }
  return tx
}

async function createSmtpTransport() {
  const tx = nodemailer.createTransport(emailConfig.smtp)
  transporter = tx
  transporterMode = 'smtp'
  return tx
}

async function ensureTransporter() {
  if (transporter) return transporter
  if (initPromise) return initPromise

  initPromise = (async () => {
    // Explicit console mode always wins — even with SMTP creds present —
    // so `SMTP_MODE=console` never attempts real delivery (and never 502s).
    if (isConsoleMode()) {
      transporter = null
      transporterMode = null
      return null
    }
    if (shouldUseEthereal()) {
      try {
        return await createEtherealTransport()
      } catch (err) {
        if (config.isProd) throw err
        // Dev without network (Ethereal API unreachable): fall back to the
        // console logger so sign-up keeps working offline.
        console.warn(`[MAILER] Ethereal unavailable (${err.message}) — using console fallback`)
        transporter = null
        transporterMode = null
        return null
      }
    }
    if (!isEmailConfigured()) {
      return null
    }
    return createSmtpTransport()
  })()

  try {
    return await initPromise
  } finally {
    initPromise = null
  }
}

function getTransporterSync() {
  return transporter
}

async function sendEmail({ to, subject, text, html }) {
  const tx = await ensureTransporter()

  if (!tx) {
    if (config.isProd) {
      const error = new Error('Email delivery is unavailable')
      error.code = 'email_unavailable'
      error.status = 503
      throw error
    }
    // Never persist recipients, verification codes or reset links in logs.
    console.log('[MAILER] Development delivery disabled; message not sent')
    return { delivery: 'console', success: true }
  }

  const from =
    transporterMode === 'ethereal'
      ? `"${emailConfig.appName}" <${etherealAccount.user}>`
      : emailConfig.from

  try {
    const info = await tx.sendMail({ from, to, subject, text, html })
    const previewUrl = nodemailer.getTestMessageUrl(info) || null
    if (!config.isProd) {
      // eslint-disable-next-line no-console
      console.log('[MAILER] Email sent:', info.messageId)
    }
    return {
      delivery: transporterMode === 'ethereal' ? 'ethereal' : 'smtp',
      success: true,
      messageId: info.messageId,
      previewUrl,
    }
  } catch (error) {
    console.error('❌ [MAILER] Error sending email:', error.message)
    throw error
  }
}

async function sendVerificationEmail(to, code, options = {}) {
  const expiresMinutes = options.expiresMinutes || 10
  const html = verificationCodeTemplate({
    appName: emailConfig.appName,
    code,
    expiresMinutes,
  })
  const text = `Your ${emailConfig.appName} verification code is: ${code}\n\nThis code will expire in ${expiresMinutes} minutes.\n\nIf you didn't request this, please ignore this email.`

  return sendEmail({
    to,
    subject: `${emailConfig.appName} - Verification Code: ${code}`,
    text,
    html,
  })
}

async function sendWelcomeEmail(to, userName) {
  const html = welcomeEmailTemplate({
    appName: emailConfig.appName,
    userName,
    appUrl: emailConfig.appUrl,
  })
  const text = `Welcome to ${emailConfig.appName}, ${userName}!\n\nYour account has been successfully created.\n\nVisit: ${emailConfig.appUrl}`

  return sendEmail({
    to,
    subject: `Welcome to ${emailConfig.appName}!`,
    text,
    html,
  })
}

async function sendPasswordResetEmail(to, resetToken, options = {}) {
  const expiresMinutes = options.expiresMinutes || 30
  const resetUrl = `${emailConfig.appUrl}/reset-password?token=${resetToken}`
  const html = passwordResetTemplate({
    appName: emailConfig.appName,
    resetUrl,
    expiresMinutes,
  })
  const text = `Reset your ${emailConfig.appName} password by visiting:\n\n${resetUrl}\n\nThis link expires in ${expiresMinutes} minutes.`

  return sendEmail({
    to,
    subject: `${emailConfig.appName} - Password Reset Request`,
    text,
    html,
  })
}

async function verifySmtpConnection(options = {}) {
  const timeoutMs = options.timeoutMs || 8000
  const tx = await ensureTransporter()
  if (!tx) return { ok: false, reason: 'not-configured', mode: null }

  try {
    await Promise.race([
      tx.verify(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP verify timeout')), timeoutMs)),
    ])
    return { ok: true, mode: transporterMode }
  } catch (error) {
    return { ok: false, reason: error.code || error.message, mode: transporterMode }
  }
}

async function logEmailStatus() {
  if (isConsoleMode()) {
    if (!config.isProd) {
      // eslint-disable-next-line no-console
      console.log('[MAILER] Console mode (SMTP_MODE=console)')
    }
    return
  }
  if (shouldUseEthereal()) {
    if (!config.isProd) {
      // eslint-disable-next-line no-console
      console.log('[MAILER] Dev SMTP mode: Ethereal (test inbox)')
    }
    const result = await verifySmtpConnection()
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error(`[MAILER] Ethereal SMTP failed: ${result.reason}`)
    }
    return
  }

  if (isEmailConfigured()) {
    if (!config.isProd) {
      // eslint-disable-next-line no-console
      console.log(`[MAILER] SMTP configured: ${emailConfig.smtp.host}`)
    }
    const result = await verifySmtpConnection()
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error(`[MAILER] SMTP verification failed: ${result.reason}`)
    }
    return
  }

  if (!config.isProd) {
    // eslint-disable-next-line no-console
    console.log('[MAILER] Email not configured - using console fallback')
  }
}

function _resetTransporter() {
  transporter = null
  transporterMode = null
  etherealAccount = null
  initPromise = null
}

function getDeliveryMode() {
  if (transporterMode) return transporterMode
  if (isConsoleMode()) return 'console'
  if (shouldUseEthereal()) return 'ethereal'
  if (isEmailConfigured()) return 'smtp'
  return 'console'
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  verifySmtpConnection,
  logEmailStatus,
  isEmailConfigured,
  isConsoleMode,
  getDeliveryMode,
  getTransporterSync,
  _resetTransporter,
}
