import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, LogOut, ShieldCheck, Users } from 'lucide-react'
import PasswordInput from '../components/auth/PasswordInput'
import PasswordStrength from '../components/auth/PasswordStrength'
import Reveal from '../components/Reveal'
import { isMockToken, usersApi } from '../services/api'
import { useAuthStore } from '../store/authStore'
import { validateStrongPassword } from '../utils/validation'
import { isManagerRole } from '../utils/roles'

const AUTH_ROLES = ['Developer', 'Team Lead', 'Project Manager']

// Manager-only user administration. Hidden for developers and offline mock
// sessions (the backend owns roles; there is nothing local to edit).
function UserRolesPanel() {
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const [users, setUsers] = useState(null) // null = loading
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState('')

  const enabled = isManagerRole(user?.role) && !isMockToken(token)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    usersApi
      .list(token)
      .then((data) => { if (!cancelled) setUsers(Array.isArray(data.users) ? data.users : []) })
      .catch((err) => { if (!cancelled) { setUsers([]); setError(err.message || 'Could not load users.') } })
    return () => { cancelled = true }
  }, [enabled, token])

  if (!enabled) return null

  async function changeRole(id, role) {
    setSavingId(id)
    setError('')
    try {
      const data = await usersApi.updateRole(token, id, role)
      setUsers((current) => current.map((entry) => (entry.id === id ? data.user : entry)))
    } catch (err) {
      setError(err.message || 'Could not update role.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <Reveal className="mt-6 rounded-xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#1a2340] text-[#34d399]"><Users size={19} /></span>
        <div>
          <h3 className="text-lg font-bold text-[#eef1f8]">User roles</h3>
          <p className="text-xs text-[#8f99b0]">Promote or demote workspace members. Changes sign them out.</p>
        </div>
      </div>
      {users === null ? (
        <p className="mt-5 flex items-center gap-2 text-sm text-[#8f99b0]"><Loader2 size={15} className="animate-spin" /> Loading users...</p>
      ) : (
        <div className="mt-5 space-y-3">
          {users.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-3 rounded-lg border border-[#1e2642] bg-[#0e1428] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[#dbe2ef]">{entry.name}</p>
                <p className="mt-0.5 truncate text-xs text-[#8f99b0]">{entry.email}</p>
              </div>
              {entry.id === user?.id ? (
                <span className="w-fit rounded-full bg-[#1a2340] px-2.5 py-1 text-[10px] font-bold text-[#8f99b0]">You · {entry.role}</span>
              ) : (
                <select
                  aria-label={`Role for ${entry.name}`}
                  value={entry.role}
                  disabled={savingId === entry.id}
                  onChange={(event) => changeRole(entry.id, event.target.value)}
                  className="rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2 text-sm text-[#eef1f8] outline-none disabled:opacity-50"
                >
                  {AUTH_ROLES.map((role) => <option key={role}>{role}</option>)}
                </select>
              )}
            </div>
          ))}
          {users.length === 0 && !error && <p className="text-sm text-[#8f99b0]">No users found.</p>}
        </div>
      )}
      {error && <p role="alert" className="animate-shake mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-3 text-sm font-semibold text-[#f87171]">{error}</p>}
    </Reveal>
  )
}

function SettingsPage() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const changePassword = useAuthStore((state) => state.changePassword)
  const logout = useAuthStore((state) => state.logout)
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState({ type: '', message: '' })
  const [isSubmitting, setIsSubmitting] = useState(false)

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: '' }))
    if (status.message) setStatus({ type: '', message: '' })
  }

  async function submitForm(event) {
    event.preventDefault()
    const nextErrors = {}
    if (!form.currentPassword) nextErrors.currentPassword = 'Current password is required.'
    nextErrors.newPassword = validateStrongPassword(form.newPassword)
    if (!form.confirmPassword) nextErrors.confirmPassword = 'Please confirm your new password.'
    else if (form.newPassword !== form.confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.'
    Object.keys(nextErrors).forEach((key) => { if (!nextErrors[key]) delete nextErrors[key] })
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return
    setIsSubmitting(true)
    setStatus({ type: '', message: '' })
    try {
      await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword })
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setStatus({ type: 'success', message: 'Password updated. All other sessions were signed out.' })
    } catch (err) {
      const message = err.status === 401 ? 'Current password is incorrect.' : err.message || 'Password update failed.'
      setStatus({ type: 'error', message })
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <section className="page-enter mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 lg:py-10">
      <div className="mb-8">
        <p className="animate-fade-in mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">Workspace</p>
        <h2 className="greeting-heading text-3xl font-bold tracking-tight text-[#eef1f8] sm:text-4xl">Settings</h2>
        <p className="animate-fade-up mt-2 text-sm text-[#8f99b0] sm:text-base" style={{ animationDelay: '0.15s' }}>Manage your profile and keep your account secure.</p>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Reveal className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          <h3 className="text-lg font-bold text-[#eef1f8]">Profile</h3>
          <div className="mt-5 flex items-center gap-4">
            <span className="animate-pop-in grid h-14 w-14 place-items-center rounded-full bg-[#f59e0b] text-xl font-bold text-[#231303]">
              {(user?.name?.[0] || user?.email?.[0] || 'U').toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate font-bold text-[#eef1f8]">{user?.name || user?.email?.split('@')[0] || 'User'}</p>
              <p className="mt-0.5 truncate text-sm text-[#8f99b0]">{user?.email}</p>
            </div>
          </div>
          <div className="mt-5 space-y-3 border-t border-[#1e2642] pt-5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#8f99b0]">Role</span>
              <span className="rounded-full bg-[#1a2340] px-2.5 py-1 text-[10px] font-bold text-[#34d399]">{user?.role || 'Developer'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[#8f99b0]">Session</span>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#34d399]"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#34d399]" /> Signed in</span>
            </div>
          </div>
          <button type="button" onClick={handleLogout} className="btn-press mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#2b3558] bg-[#121a2e] px-4 py-3 text-sm font-bold text-[#b9c2d6] transition hover:border-[#f87171]/50 hover:text-[#f87171]">
            <LogOut size={16} /> Sign out
          </button>
        </Reveal>

        <Reveal delay={100} className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#1a2340] text-[#fbbf24]"><ShieldCheck size={19} /></span>
            <div>
              <h3 className="text-lg font-bold text-[#eef1f8]">Account security</h3>
              <p className="text-xs text-[#8f99b0]">Change your password anytime.</p>
            </div>
          </div>
          <ul className="mt-5 space-y-2 rounded-lg border border-[#1e2642] bg-[#0e1428] p-4 text-xs leading-5 text-[#8f99b0]">
            <li>· Passwords need 8+ characters with uppercase, number, and symbol.</li>
            <li>· Accounts lock for 15 minutes after 5 failed sign-in attempts.</li>
            <li>· Changing your password signs out all other sessions.</li>
            <li>· Only Team Leads and Project Managers can invite members or change roles.</li>
          </ul>
          <form onSubmit={submitForm} noValidate className="animate-stagger mt-5 space-y-4">
            <PasswordInput id="currentPassword" label="Current password" value={form.currentPassword} onChange={updateField} placeholder="Enter your current password" autoComplete="current-password" error={errors.currentPassword} />
            <div>
              <PasswordInput id="newPassword" label="New password" value={form.newPassword} onChange={updateField} placeholder="Choose a strong password" autoComplete="new-password" error={errors.newPassword} />
              <PasswordStrength password={form.newPassword} />
            </div>
            <PasswordInput id="confirmPassword" label="Confirm new password" value={form.confirmPassword} onChange={updateField} placeholder="Repeat your new password" autoComplete="new-password" error={errors.confirmPassword} />
            {status.type === 'error' && <p role="alert" className="animate-shake rounded-lg border border-red-500/20 bg-red-500/10 px-3.5 py-3 text-sm font-semibold text-[#f87171]">{status.message}</p>}
            {status.type === 'success' && <p role="status" className="animate-fade-in rounded-lg border border-[#34d399]/25 bg-[#34d399]/10 px-3.5 py-3 text-sm font-semibold text-[#34d399]">{status.message}</p>}
            <button type="submit" disabled={isSubmitting} className="btn-press btn-shine inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-60">
              {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Updating...</> : 'Update password'}
            </button>
          </form>
        </Reveal>
      </div>

      <UserRolesPanel />
    </section>
  )
}

export default SettingsPage
