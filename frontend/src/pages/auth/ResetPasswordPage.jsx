import { CheckCircle2, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AuthBrand from '../../components/auth/AuthBrand'
import Logo from '../../components/Logo'
import PasswordInput from '../../components/auth/PasswordInput'
import PasswordStrength from '../../components/auth/PasswordStrength'
import { useAuthStore } from '../../store/authStore'
import { validateStrongPassword } from '../../utils/validation'

function ResetPasswordPage() {
  const resetPassword = useAuthStore((state) => state.resetPassword)
  const [searchParams] = useSearchParams()
  const token = (searchParams.get('token') || '').trim()
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [requestError, setRequestError] = useState('')
  const [done, setDone] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: '' }))
    setRequestError('')
  }

  async function submitForm(event) {
    event.preventDefault()
    const nextErrors = { newPassword: validateStrongPassword(form.newPassword) }
    if (!form.confirmPassword) nextErrors.confirmPassword = 'Please confirm your new password.'
    else if (form.newPassword !== form.confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.'
    Object.keys(nextErrors).forEach((key) => { if (!nextErrors[key]) delete nextErrors[key] })
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return
    setIsSubmitting(true)
    setRequestError('')
    try {
      await resetPassword({ token, newPassword: form.newPassword })
      setDone(true)
    } catch (err) {
      setRequestError(err.message || 'Could not reset your password. Request a new link.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <AuthBrand />
      <div className="animate-scale-in rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.4)] sm:p-9">
        <div className="mb-8">
          <div className="animate-float mb-5 w-fit"><Logo size={44} iconSize={24} className="rounded-xl" /></div>
          <h2 className="text-3xl font-bold tracking-tight text-[#eef1f8]">Choose a new password</h2>
          <p className="mt-2 text-sm leading-6 text-[#8f99b0]">Pick a strong password to secure your workspace.</p>
        </div>
        {!token ? (
          <div className="space-y-5">
            <p role="alert" className="animate-shake rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-3 text-sm font-semibold text-[#f87171]">
              This reset link is missing its token. Request a new one to continue.
            </p>
            <p className="text-center text-sm text-[#8f99b0]">
              <Link to="/forgot-password" className="link-underline font-bold text-[#34d399] hover:text-[#f59e0b]">Request a new link</Link>
            </p>
          </div>
        ) : done ? (
          <div className="space-y-5">
            <p role="status" className="flex items-start gap-2 rounded-lg border border-[#34d399]/25 bg-[#34d399]/10 px-3.5 py-3 text-sm leading-6 text-[#a7f3d0]">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              Password updated. You can now sign in with your new password.
            </p>
            <Link
              to="/login"
              className="btn-press btn-shine inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24]"
            >
              Sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submitForm} noValidate className="animate-stagger space-y-5">
            <div>
              <PasswordInput
                id="newPassword"
                label="New password"
                value={form.newPassword}
                onChange={updateField}
                placeholder="Uppercase, number & symbol"
                autoComplete="new-password"
                error={errors.newPassword}
              />
              <PasswordStrength password={form.newPassword} />
            </div>
            <PasswordInput
              id="confirmPassword"
              label="Confirm new password"
              value={form.confirmPassword}
              onChange={updateField}
              placeholder="Repeat your new password"
              autoComplete="new-password"
              error={errors.confirmPassword}
            />
            {requestError && (
              <p role="alert" className="animate-shake rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-3 text-sm font-semibold text-[#f87171]">
                {requestError}
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-press btn-shine inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Updating...</> : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </>
  )
}

export default ResetPasswordPage
