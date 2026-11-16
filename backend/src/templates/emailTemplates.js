function verificationCodeTemplate({ appName, code, expiresMinutes }) {
  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 600px; margin: 0 auto;">
      <h2 style="margin-bottom: 12px;">Your ${appName} verification code</h2>
      <p>Use the code below to verify your email address.</p>
      <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; text-align: center; padding: 24px; margin: 24px 0; background: #f3f4f6; border-radius: 8px; color: #111827;">
        ${code}
      </div>
      <p>This code expires in ${expiresMinutes} minutes.</p>
      <p>If you did not request this, you can safely ignore this email.</p>
    </div>
  `
}

function welcomeEmailTemplate({ appName, userName, appUrl }) {
  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 600px; margin: 0 auto;">
      <h2 style="margin-bottom: 12px;">Welcome to ${appName}, ${userName}!</h2>
      <p>Your account has been created successfully.</p>
      <p>Get started by visiting <a href="${appUrl}">${appUrl}</a>.</p>
    </div>
  `
}

function passwordResetTemplate({ appName, resetUrl, expiresMinutes }) {
  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; max-width: 600px; margin: 0 auto;">
      <h2 style="margin-bottom: 12px;">Reset your ${appName} password</h2>
      <p>We received a request to reset your password.</p>
      <p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 18px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
          Reset Password
        </a>
      </p>
      <p>This link expires in ${expiresMinutes} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    </div>
  `
}

module.exports = {
  verificationCodeTemplate,
  welcomeEmailTemplate,
  passwordResetTemplate,
}
