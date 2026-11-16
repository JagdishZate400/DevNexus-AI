import { CheckCircle2, Loader2, MailCheck, RefreshCw, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthBrand from '../../components/auth/AuthBrand'
import AuthInput from '../../components/auth/AuthInput'
import PasswordInput from '../../components/auth/PasswordInput'
import PasswordStrength from '../../components/auth/PasswordStrength'
import { useAuthStore } from '../../store/authStore'
import { validateEmail, validateStrongPassword } from '../../utils/validation'

const roles = ['Developer', 'Team Lead', 'Project Manager']
const CODE_LENGTH = 6
const RESEND_COOLDOWN_S = 30

function CodeBoxes({ value, onChange, disabled, hasError }) {
  const inputsRef = useRef([])

  function focusBox(index) {
    inputsRef.current[index]?.focus()
    inputsRef.current[index]?.select()
  }

  function handleChange(index, raw) {
    const digit = raw.replace(/\D/g, '').slice(-1)
    const next = value.split('')
    while (next.length < CODE_LENGTH) next.push('')
    next[index] = digit
    onChange(next.join(''))
    if (digit && index < CODE_LENGTH - 1) focusBox(index + 1)
  }

  function handleKeyDown(index, event) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const next = value.split('')
      while (next.length < CODE_LENGTH) next.push('')
      if (next[index]) {
        next[index] = ''
        onChange(next.join(''))
      } else if (index > 0) {
        next[index - 1] = ''
        onChange(next.join(''))
        focusBox(index - 1)
      }
    }
    if (event.key === 'ArrowLeft' && index > 0) focusBox(index - 1)
    if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) focusBox(index + 1)
  }

  function handlePaste(event) {
    event.preventDefault()
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH)
    if (!digits) return
    onChange(digits)
    focusBox(Math.min(digits.length, CODE_LENGTH - 1))
  }

  return (
    <div className="flex items-center gap-2" onPaste={handlePaste}>
      {Array.from({ length: CODE_LENGTH }).map((_, index) => (
        <input
          key={index}
          ref={(node) => { inputsRef.current[index] = node }}
          value={value[index] || ''}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoFocus={index === 0}
          aria-label={`Verification code digit ${index + 1}`}
          maxLength={1}
          className={`h-12 w-full rounded-lg border bg-[#0e1428] text-center text-lg font-bold tabular-nums text-[#eef1f8] outline-none transition focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50 ${hasError ? 'border-[#f87171] focus:border-[#f87171] focus:ring-[#f87171]/10' : 'border-[#2b3558] focus:border-[#f59e0b] focus:ring-[#f59e0b]/10'}`}
        />
      ))}
    </div>
  )
}

function RegisterPage() {
  const navigate = useNavigate()
  const register = useAuthStore((state) => state.register)
  const requestVerificationCode = useAuthStore((state) => state.requestVerificationCode)
  const verifyEmailCode = useAuthStore((state) => state.verifyEmailCode)
  const authError = useAuthStore((state) => state.authError)
  const clearAuthError = useAuthStore((state) => state.clearAuthError)
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '', role: 'Developer' })
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Email verification state.
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeError, setCodeError] = useState('')
  const [codeMessage, setCodeMessage] = useState('')
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifiedEmail, setVerifiedEmail] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [expiresAt, setExpiresAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const verifyingRef = useRef(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setInterval(() => setCooldown((current) => Math.max(0, current - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown])

  useEffect(() => {
    if (!codeSent || verifiedEmail) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [codeSent, verifiedEmail])

  const normalizedEmail = form.email.trim().toLowerCase()
  const isVerified = verifiedEmail && verifiedEmail === normalizedEmail
  const remainingMs = expiresAt - now
  const codeExpired = codeSent && !isVerified && expiresAt > 0 && remainingMs <= 0
  function formatRemaining(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000))
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  }

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: '', verification: name === 'email' ? '' : current.verification }))
    if (name === 'email') {
      // Changing the address invalidates any prior verification.
      setVerifiedEmail('')
      setCodeError('')
    }
    if (authError) clearAuthError()
  }

  async function sendCode(event) {
    event?.preventDefault()
    const emailError = validateEmail(form.email)
    if (emailError) {
      setErrors((current) => ({ ...current, email: emailError }))
      return
    }
    setIsSendingCode(true)
    setCodeError('')
    try {
      const data = await requestVerificationCode(form.email.trim())
      setCodeSent(true)
      setCode('')
      setPreviewUrl(data.previewUrl || '')
      if (data.delivery === 'ethereal' && data.previewUrl) {
        setCodeMessage('Test email sent. Open the preview link below to read your 6-digit code.')
      } else if (data.delivery === 'console' || data.emailConfigured === false) {
        setCodeMessage('Dev mode: email is not configured. Check the backend terminal / email-dev.log for your code, or set SMTP_MODE=ethereal.')
      } else {
        setCodeMessage(data.message || `Verification code emailed to ${form.email.trim()}. Check your inbox and spam folder.`)
      }
      setExpiresAt(Date.now() + (data.expiresIn || 600) * 1000)
      setNow(Date.now())
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      const retryAfter = err?.data?.retryAfter
      if (typeof retryAfter === 'number' && retryAfter > 0) setCooldown(retryAfter)
      setCodeError(err.message || 'Could not send the verification code. Try again.')
    } finally {
      setIsSendingCode(false)
    }
  }

  function handleCodeChange(next) {
    setCode(next)
    setCodeError('')
    if (next.length === CODE_LENGTH && !verifyingRef.current) verifyCode(undefined, next)
  }

  async function verifyCode(event, explicit) {
    event?.preventDefault()
    const submitted = String(explicit ?? code).trim()
    if (submitted.length !== CODE_LENGTH) {
      setCodeError(`Enter the ${CODE_LENGTH}-digit code from your email.`)
      return
    }
    if (verifyingRef.current) return
    verifyingRef.current = true
    setIsVerifying(true)
    setCodeError('')
    try {
      await verifyEmailCode(form.email.trim(), submitted)
      setVerifiedEmail(normalizedEmail)
      setCodeMessage('Email verified. You can now create your account.')
    } catch (err) {
      setCodeError(err.message || 'Incorrect code. Try again.')
    } finally {
      verifyingRef.current = false
      setIsVerifying(false)
    }
  }

  async function submitForm(event) {
    event.preventDefault()
    const nextErrors = {}
    if (!form.fullName.trim()) nextErrors.fullName = 'Full name is required.'
    nextErrors.email = validateEmail(form.email)
    nextErrors.password = validateStrongPassword(form.password)
    if (!form.confirmPassword) nextErrors.confirmPassword = 'Please confirm your password.'
    else if (form.password !== form.confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.'
    if (!verifiedEmail || verifiedEmail !== normalizedEmail) {
      nextErrors.verification = 'Please verify your email address with the 6-digit code first.'
    }
    // Remove empty errors so `some(Boolean)` only sees real messages.
    Object.keys(nextErrors).forEach((key) => { if (!nextErrors[key]) delete nextErrors[key] })
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return
    setIsSubmitting(true)
    try {
      await register({ fullName: form.fullName.trim(), email: form.email.trim(), password: form.password, role: form.role })
      navigate('/dashboard', { replace: true })
    } catch {
      // authError in store is displayed below.
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <AuthBrand />
      <div className="animate-scale-in rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.4)] sm:p-9">
        <div className="mb-7"><h2 className="text-3xl font-bold tracking-tight text-[#eef1f8]">Create your account</h2><p className="mt-2 text-sm leading-6 text-[#8f99b0]">Verify your email, then set up your workspace profile.</p></div>
        <form onSubmit={submitForm} noValidate className="animate-stagger space-y-4">
          <AuthInput id="fullName" label="Full name" value={form.fullName} onChange={updateField} placeholder="Full name" autoComplete="name" error={errors.fullName} />
          <AuthInput id="email" label="Email" type="email" value={form.email} onChange={updateField} placeholder="you@company.com" autoComplete="email" error={errors.email} />

          {/* ---------- Email verification ---------- */}
          <div className="rounded-xl border border-[#2b3558] bg-[#0e1428]/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-bold text-[#dbe2ef]">
                <MailCheck size={16} className={isVerified ? 'text-[#34d399]' : 'text-[#f59e0b]'} />
                Email verification
                {isVerified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#34d399]/15 px-2 py-0.5 text-[11px] font-bold text-[#34d399]">
                    <CheckCircle2 size={12} /> Verified
                  </span>
                )}
              </p>
              {!isVerified && codeSent && (
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={isSendingCode || cooldown > 0}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#f59e0b] transition hover:text-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={13} className={isSendingCode ? 'animate-spin' : ''} />
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              )}
            </div>

            {isVerified ? (
              <p className="mt-3 rounded-lg border border-[#34d399]/25 bg-[#34d399]/10 px-3.5 py-2.5 text-xs leading-5 text-[#a7f3d0]">
                <span className="font-bold">{verifiedEmail}</span> is verified. If you change the email address above, you&apos;ll need to verify again.
              </p>
            ) : !codeSent ? (
              <div className="mt-3">
                <p className="text-xs leading-5 text-[#8f99b0]">We&apos;ll email a 6-digit code to confirm you own this address.</p>
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={isSendingCode}
                  className="btn-press mt-3 inline-flex items-center gap-2 rounded-lg border border-[#f59e0b]/50 bg-[#f59e0b]/10 px-4 py-2.5 text-xs font-bold text-[#fcd34d] transition hover:bg-[#f59e0b]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSendingCode ? <><Loader2 size={14} className="animate-spin" /> Sending code...</> : <><Send size={14} /> Send verification code</>}
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-xs leading-5 text-[#8f99b0]">Enter the 6-digit code emailed to <span className="font-bold text-[#dbe2ef]">{form.email.trim()}</span>. Check your spam folder if you don&apos;t see it.</p>
                <CodeBoxes value={code} onChange={handleCodeChange} disabled={isVerifying} hasError={Boolean(codeError)} />
                {codeError && <p role="alert" className="animate-shake text-xs font-medium text-[#f87171]">{codeError}</p>}
                {!codeError && codeMessage && <p aria-live="polite" className="text-xs font-medium text-[#8f99b0]">{codeMessage}</p>}
                {!codeError && previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-[#34d399] underline-offset-2 hover:text-[#f59e0b] hover:underline"
                  >
                    Open verification email preview
                  </a>
                )}
                {!codeError && !codeExpired && expiresAt > 0 && (
                  <p aria-live="off" className="text-xs font-semibold tabular-nums text-[#f59e0b]">Code expires in {formatRemaining(remainingMs)}</p>
                )}
                {!codeError && codeExpired && (
                  <p role="alert" className="text-xs font-semibold text-[#fbbf24]">That code expired. Resend a new one to continue.</p>
                )}
                <button
                  type="button"
                  onClick={verifyCode}
                  disabled={isVerifying || code.trim().length !== CODE_LENGTH}
                  className="btn-press btn-shine inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#34d399] px-4 py-2.5 text-xs font-bold text-[#06251a] transition hover:bg-[#6ee7b7] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isVerifying ? <><Loader2 size={14} className="animate-spin" /> Verifying...</> : <><CheckCircle2 size={14} /> Verify email</>}
                </button>
              </div>
            )}
            {errors.verification && !isVerified && <p role="alert" className="animate-shake mt-3 text-xs font-medium text-[#f87171]">{errors.verification}</p>}
          </div>

          <div>
            <PasswordInput id="password" label="Password" value={form.password} onChange={updateField} placeholder="Uppercase, number & symbol" autoComplete="new-password" error={errors.password} />
            <PasswordStrength password={form.password} />
          </div>
          <PasswordInput id="confirmPassword" label="Confirm password" value={form.confirmPassword} onChange={updateField} placeholder="Repeat your password" autoComplete="new-password" error={errors.confirmPassword} />
          <div><label htmlFor="role" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Role</label><select id="role" name="role" value={form.role} onChange={updateField} className="w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3.5 py-3 text-sm text-[#eef1f8] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10">{roles.map((role) => <option key={role}>{role}</option>)}</select></div>
          {authError && <p role="alert" className="animate-shake rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-3 text-sm font-semibold text-[#f87171]">{authError}</p>}
          <button type="submit" disabled={isSubmitting} className="btn-press btn-shine mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Creating account...</> : 'Create account'}</button>
        </form>
        <p className="mt-7 text-center text-sm text-[#8f99b0]">Already have an account? <Link to="/login" className="link-underline font-bold text-[#34d399] hover:text-[#f59e0b]">Sign in</Link></p>
      </div>
    </>
  )
}

export default RegisterPage
