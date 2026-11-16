import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthBrand from '../../components/auth/AuthBrand'
import Logo from '../../components/Logo'
import AuthInput from '../../components/auth/AuthInput'
import PasswordInput from '../../components/auth/PasswordInput'
import { useAuthStore } from '../../store/authStore'
import { validateEmail } from '../../utils/validation'

function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useAuthStore((state) => state.login)
  const authError = useAuthStore((state) => state.authError)
  const clearAuthError = useAuthStore((state) => state.clearAuthError)
  const [form, setForm] = useState({ email: '', password: '', remember: false })
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateField(event) {
    const { name, value, checked, type } = event.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
    setErrors((current) => ({ ...current, [name]: '' }))
    if (authError) clearAuthError()
  }

  async function submitForm(event) {
    event.preventDefault()
    const nextErrors = { email: validateEmail(form.email) }
    if (!form.password) nextErrors.password = 'Password is required.'
    Object.keys(nextErrors).forEach((key) => { if (!nextErrors[key]) delete nextErrors[key] })
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return
    setIsSubmitting(true)
    try {
      await login({ email: form.email.trim(), password: form.password, remember: form.remember })
      const from = location.state?.from || '/dashboard'
      navigate(from, { replace: true })
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
        <div className="mb-8">
          <div className="animate-float mb-5 w-fit"><Logo size={44} iconSize={24} className="rounded-xl" /></div>
          <h2 className="text-3xl font-bold tracking-tight text-[#eef1f8]">Welcome back</h2>
          <p className="mt-2 text-sm leading-6 text-[#8f99b0]">Sign in to continue to your engineering workspace.</p>
        </div>
        <form onSubmit={submitForm} noValidate className="animate-stagger space-y-5">
          <AuthInput id="email" label="Email" type="email" value={form.email} onChange={updateField} placeholder="you@company.com" autoComplete="email" error={errors.email} />
          <PasswordInput id="password" label="Password" value={form.password} onChange={updateField} placeholder="Enter your password" autoComplete="current-password" error={errors.password} />
          {authError && <p role="alert" className="animate-shake rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-3 text-sm font-semibold text-[#f87171]">{authError}</p>}
          <div className="flex items-center justify-between gap-4 text-sm">
            <label className="flex items-center gap-2 text-[#8f99b0]"><input type="checkbox" name="remember" checked={form.remember} onChange={updateField} className="h-4 w-4 rounded border-[#2b3558] accent-[#34d399]" />Remember me</label>
            <Link to="/forgot-password" className="link-underline font-semibold text-[#34d399] hover:text-[#f59e0b]">Forgot password?</Link>
          </div>
          <button type="submit" disabled={isSubmitting} className="btn-press btn-shine inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Signing in...</> : 'Sign in'}</button>
        </form>
        <p className="mt-7 text-center text-sm text-[#8f99b0]">Don't have an account? <Link to="/register" className="link-underline font-bold text-[#34d399] hover:text-[#f59e0b]">Create account</Link></p>
      </div>
    </>
  )
}

export default LoginPage
