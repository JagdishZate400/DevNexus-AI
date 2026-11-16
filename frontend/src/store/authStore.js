import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { authApi, isBackendUnreachable, isMockToken, setRefreshHandler } from '../services/api.js'

function unreachableError() {
  return new Error('Cannot reach the server. Make sure the backend is running, then try again.')
}

// Shared in-flight refresh so parallel 401s trigger a single /auth/refresh.
let refreshPromise = null

let projectResetCallback = null
export function registerProjectResetHandler(fn) {
  projectResetCallback = fn
}

export function clearProjectCache() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('ai-assistant-projects')
    }
  } catch {}
  if (typeof projectResetCallback === 'function') {
    try {
      projectResetCallback()
    } catch {}
  }
}

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,
      // Session-only when false: a fresh tab signs out (see tab marker below).
      rememberMe: true,
      authError: '',
      clearAuthError: () => set({ authError: '' }),
      login: async ({ email, password, remember = false }) => {
        set({ authError: '' })
        clearProjectCache()
        const cleanEmail = String(email || '').trim()
        try {
          const data = await authApi.login({ email: cleanEmail, password })
          if (!data?.user || typeof data.token !== 'string' || isMockToken(data.token)) throw new Error('The server returned an invalid sign-in session.')
          set({ user: data.user, token: data.token, refreshToken: data.refreshToken || null, rememberMe: remember === true, authError: '' })
          return data
        } catch (err) {
          if (isBackendUnreachable(err)) {
            const message = 'Cannot reach the server. Check the backend address and allowed frontend origin, then try again.'
            set({ user: null, token: null, refreshToken: null, authError: message })
            throw new Error(message)
          }
          const message = err.status === 401 ? 'Invalid email or password.' : err.message || 'Sign in failed.'
          set({ authError: message })
          throw err
        }
      },
      register: async ({ fullName, email, password, role }) => {
        set({ authError: '' })
        clearProjectCache()
        const payload = { fullName: String(fullName || '').trim(), email: String(email || '').trim(), password, role }
        try {
          const data = await authApi.register(payload)
          set({ user: data.user, token: data.token, refreshToken: data.refreshToken || null, rememberMe: true, authError: '' })
          return data
        } catch (err) {
          if (isBackendUnreachable(err)) {
            // Registration requires a verified email, which only the backend
            // can do (it sends the code). Fail closed — no mock bypass.
            const message = 'Cannot reach the server. Make sure the backend is running, then try again.'
            set({ authError: message })
            throw new Error(message)
          }
          const message = err.data?.errors?.[0]?.message || err.message || 'Registration failed.'
          set({ authError: message })
          throw err
        }
      },
      requestVerificationCode: async (email) => {
        const cleanEmail = String(email || '').trim()
        try {
          const data = await authApi.requestCode({ email: cleanEmail })
          return data
        } catch (err) {
          if (isBackendUnreachable(err)) throw unreachableError()
          throw err
        }
      },
      verifyEmailCode: async (email, code) => {
        const cleanEmail = String(email || '').trim()
        const cleanCode = String(code || '').trim()
        try {
          const data = await authApi.verifyCode({ email: cleanEmail, code: cleanCode })
          return data
        } catch (err) {
          if (isBackendUnreachable(err)) throw unreachableError()
          throw err
        }
      },
      forgotPassword: async (email) => {
        const cleanEmail = String(email || '').trim()
        try {
          return await authApi.forgotPassword({ email: cleanEmail })
        } catch (err) {
          if (isBackendUnreachable(err)) throw unreachableError()
          throw err
        }
      },
      resetPassword: async ({ token, newPassword }) => {
        try {
          return await authApi.resetPassword({ token, newPassword })
        } catch (err) {
          if (isBackendUnreachable(err)) throw unreachableError()
          throw err
        }
      },
      // Single silent refresh. Returns the fresh access token, or null when
      // the session is dead (caller signs out). Never throws for refresh
      // failures — only network errors propagate so callers can stay offline.
      refreshSession: async () => {
        if (refreshPromise) return refreshPromise
        refreshPromise = (async () => {
          const { refreshToken } = get()
          if (!refreshToken || isMockToken(refreshToken)) return null
          try {
            const data = await authApi.refresh(refreshToken)
            set({ user: data.user, token: data.token, refreshToken: data.refreshToken || null, authError: '' })
            return data.token
          } catch (err) {
            if (isBackendUnreachable(err)) throw err
            get().clearSession()
            return null
          } finally {
            refreshPromise = null
          }
        })()
        return refreshPromise
      },
      // Validate the stored session (used on app boot / navigation).
      // Returns true when signed in. Offline keeps the session; a rejected
      // real token clears it. Legacy mock tokens are invalid sessions.
      checkSession: async () => {
        const { token } = get()
        if (!token) return false
        if (isMockToken(token)) { get().clearSession(); return false }
        try {
          const data = await authApi.me(token)
          if (data?.user) set({ user: data.user })
          return true
        } catch (err) {
          if (isBackendUnreachable(err)) return true
          if (err && err.status === 401) {
            // apiFetch already attempted one silent refresh above.
            get().clearSession()
            return false
          }
          return true
        }
      },
      clearSession: () => {
        clearProjectCache()
        set({ user: null, token: null, refreshToken: null, authError: '' })
      },
      logout: () => {
        clearProjectCache()
        const { refreshToken, token } = get()
        set({ user: null, token: null, refreshToken: null, authError: '' })
        if (refreshToken || (token && !isMockToken(token))) {
          authApi.logout(refreshToken ? { refreshToken } : {}, token).catch((err) => {
            if (!isBackendUnreachable(err)) {
              // eslint-disable-next-line no-console
              console.error('[auth] logout failed:', err.message)
            }
          })
        }
      },
      changePassword: async ({ currentPassword, newPassword }) => {
        const token = get().token
        if (!token) throw new Error('You are not signed in.')
        try {
          const data = await authApi.changePassword(token, { currentPassword, newPassword })
          set({ token: data.token, refreshToken: data.refreshToken || null, authError: '' })
          return data
        } catch (err) {
          if (isBackendUnreachable(err)) throw unreachableError()
          const message = err.status === 401 ? 'Current password is incorrect.' : err.message || 'Could not change password.'
          set({ authError: message })
          throw err
        }
      },
    }),
    {
      name: 'ai-assistant-auth',
      merge: (stored, current) => {
        const session = { ...current, ...stored }
        // Older versions persisted fake offline login tokens; never restore them as sessions.
        return session.token && isMockToken(session.token) ? { ...session, user: null, token: null, refreshToken: null } : session
      },
    }
  )
)

// Authenticated apiFetch calls use this for one silent 401 retry.
setRefreshHandler(() => useAuthStore.getState().refreshSession())

// Remember-me semantics: localStorage survives tab closes, sessionStorage
// does not. The first boot in a tab drops the session unless the user opted
// into persistence (or never chose, i.e. older stored sessions).
const TAB_MARKER = 'ai-assistant-tab-alive'
if (typeof window !== 'undefined' && window.sessionStorage) {
  const finishHydration = (state) => {
    try {
      if (!window.sessionStorage.getItem(TAB_MARKER)) {
        window.sessionStorage.setItem(TAB_MARKER, '1')
        if (state?.rememberMe === false) {
          clearProjectCache()
          useAuthStore.setState({ user: null, token: null, refreshToken: null, authError: '' })
        }
      }
    } catch {
      // Storage unavailable — keep the session rather than sign out.
    }
  }
  useAuthStore.persist.onFinishHydration(finishHydration)
  if (useAuthStore.persist.hasHydrated()) finishHydration(useAuthStore.getState())
}
