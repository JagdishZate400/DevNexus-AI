import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { initialMembers } from '../data/teamData'
import { teamApi, isBackendUnreachable, isMockToken } from '../services/api'
import { useAuthStore } from './authStore'

function localMember(payload) {
  const uniqueId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    ...payload,
    id: payload.id || `member-${uniqueId}`,
    projects: payload.projects ?? 0,
    status: payload.status || 'Active',
  }
}

function friendlyInviteError(err) {
  if (err.status === 403) return new Error('Only Team Leads and Project Managers can invite members.')
  return err
}

export const useTeamStore = create(
  persist(
    (set, get) => ({
      members: initialMembers,
      isLoading: false,
      loadError: '',
      source: 'local',

      loadMembers: async () => {
        const token = useAuthStore.getState().token
        if (isMockToken(token)) {
          set({ source: 'local', loadError: '' })
          return get().members
        }
        set({ isLoading: true, loadError: '' })
        try {
          const data = await teamApi.list(token)
          const members = Array.isArray(data.members) ? data.members : []
          set({ members, isLoading: false, source: 'api', loadError: '' })
          return members
        } catch (err) {
          if (isBackendUnreachable(err)) {
            set({ isLoading: false, source: 'local', loadError: '' })
            return get().members
          }
          set({ isLoading: false, loadError: err.message || 'Could not load members.', source: 'local' })
          return get().members
        }
      },

      inviteMember: async (payload) => {
        const token = useAuthStore.getState().token
        if (isMockToken(token)) {
          const member = localMember(payload)
          set((state) => ({ members: [member, ...state.members] }))
          return { member, source: 'local' }
        }
        try {
          const data = await teamApi.invite(token, {
            name: payload.name,
            email: payload.email,
            role: payload.role || 'Engineer',
          })
          const member = data.member || localMember(payload)
          set((state) => ({ members: [member, ...state.members], source: 'api', loadError: '' }))
          return { member, source: 'api' }
        } catch (err) {
          if (isBackendUnreachable(err)) {
            const member = localMember(payload)
            set((state) => ({ members: [member, ...state.members] }))
            return { member, source: 'local', fallback: true }
          }
          throw friendlyInviteError(err)
        }
      },
    }),
    { name: 'ai-assistant-team' }
  )
)
