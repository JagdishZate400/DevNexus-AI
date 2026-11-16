import { CheckCircle2, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthBrand from '../../components/auth/AuthBrand'
import AuthInput from '../../components/auth/AuthInput'
import Logo from '../../components/Logo'
import { useAuthStore } from '../../store/authStore'
import { validateEmail } from '../../utils/validation'

function ForgotPasswordPage() {
  const forgotPassword = useAuthStore((state) => state.forgotPassword)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submitForm(event) {
    event.preventDefault()
    const emailError = validateEmail(email)
    if (emailError) {
      setError(emailError)
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      await forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(err.message || 'Could not send the reset link. Try again.')
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
          <h2 className="text-3xl font-bold tracking-tight text-[#eef1f8]">Reset password</h2>
          <p className="mt-2 text-sm leading-6 text-[#8f99b0]">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
        </div>
        {sent ? (
          <div className="space-y-5">
            <p role="status" className="flex items-start gap-2 rounded-lg border border-[#34d399]/25 bg-[#34d399]/10 px-3.5 py-3 text-sm leading-6 text-[#a7f3d0]">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0" />
              If an account exists for {email.trim()}, a reset link has been sent. Check your inbox and spam folder.
            </p>
            <p className="text-center text-sm text-[#8f99b0]">
              <Link to="/login" className="link-underline font-bold text-[#34d399] hover:text-[#f59e0b]">Back to sign in</Link>
            </p>
          </div>
        ) : (
          <form onSubmit={submitForm} noValidate className="animate-stagger space-y-5">
            <AuthInput
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={(event) => { setEmail(event.target.value); setError('') }}
              placeholder="you@company.com"
              autoComplete="email"
              error={error}
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-press btn-shine inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Sending link...</> : 'Send reset link'}
            </button>
          </form>
        )}
        {!sent && (
          <p className="mt-7 text-center text-sm text-[#8f99b0]">
            Remembered it? <Link to="/login" className="link-underline font-bold text-[#34d399] hover:text-[#f59e0b]">Sign in</Link>
          </p>
        )}
      </div>
    </>
  )
}

export default ForgotPasswordPage
