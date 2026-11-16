import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { initialSprints } from '../data/sprintsData'
import { sprintsApi, isBackendUnreachable, isMockToken } from '../services/api'
import { useAuthStore } from './authStore'

function localSprint(payload) {
  return {
    ...payload,
    id:
      payload.id ||
      `sprint-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
  }
}

export const useSprintsStore = create(
  persist(
    (set, get) => ({
      sprints: initialSprints,
      isLoading: false,
      loadError: '',
      source: 'local',

      loadSprints: async () => {
        const token = useAuthStore.getState().token
        if (isMockToken(token)) {
          set({ source: 'local', loadError: '' })
          return get().sprints
        }
        set({ isLoading: true, loadError: '' })
        try {
          const data = await sprintsApi.list(token)
          const sprints = Array.isArray(data.sprints) ? data.sprints : []
          set({ sprints, isLoading: false, source: 'api', loadError: '' })
          return sprints
        } catch (err) {
          if (isBackendUnreachable(err)) {
            set({ isLoading: false, source: 'local', loadError: '' })
            return get().sprints
          }
          set({ isLoading: false, loadError: err.message || 'Could not load sprints.', source: 'local' })
          return get().sprints
        }
      },

      addSprint: async (payload) => {
        const token = useAuthStore.getState().token
        if (isMockToken(token)) {
          const sprint = localSprint(payload)
          set((state) => ({ sprints: [sprint, ...state.sprints] }))
          return { sprint, source: 'local' }
        }
        try {
          const data = await sprintsApi.create(token, {
            name: payload.name,
            goal: payload.goal || '',
            startDate: payload.startDate || null,
            endDate: payload.endDate || null,
            status: payload.status || 'Planning',
            progress: payload.progress ?? 0,
          })
          const sprint = data.sprint || localSprint(payload)
          set((state) => ({ sprints: [sprint, ...state.sprints], source: 'api', loadError: '' }))
          return { sprint, source: 'api' }
        } catch (err) {
          if (isBackendUnreachable(err)) {
            const sprint = localSprint(payload)
            set((state) => ({ sprints: [sprint, ...state.sprints] }))
            return { sprint, source: 'local', fallback: true }
          }
          throw err
        }
      },

      setActive: async (id) => {
        const previous = get().sprints
        set((state) => ({
          sprints: state.sprints.map((sprint) => {
            if (sprint.id === id) return { ...sprint, status: 'Active' }
            if (sprint.status === 'Active') return { ...sprint, status: 'Planning' }
            return sprint
          }),
        }))
        const token = useAuthStore.getState().token
        if (isMockToken(token)) return { source: 'local' }
        try {
          const data = await sprintsApi.activate(token, id)
          if (data.sprint) {
            const activeId = data.sprint.id
            set((state) => ({
              sprints: state.sprints.map((sprint) => {
                if (sprint.id === activeId) return data.sprint
                if (sprint.status === 'Active') return { ...sprint, status: 'Planning' }
                return sprint
              }),
            }))
          }
          return { source: 'api' }
        } catch (err) {
          if (isBackendUnreachable(err)) return { source: 'local', fallback: true }
          set({ sprints: previous })
          throw err
        }
      },

      markComplete: async (id) => {
        const previous = get().sprints
        set((state) => ({
          sprints: state.sprints.map((sprint) =>
            sprint.id === id ? { ...sprint, status: 'Completed', progress: 100 } : sprint
          ),
        }))
        const token = useAuthStore.getState().token
        if (isMockToken(token)) return { source: 'local' }
        try {
          const data = await sprintsApi.complete(token, id)
          if (data.sprint) {
            set((state) => ({
              sprints: state.sprints.map((sprint) => (sprint.id === id ? data.sprint : sprint)),
            }))
          }
          return { source: 'api' }
        } catch (err) {
          if (isBackendUnreachable(err)) return { source: 'local', fallback: true }
          set({ sprints: previous })
          throw err
        }
      },
    }),
    {
      name: 'ai-assistant-sprints',
      partialize: (state) => ({ sprints: state.sprints }),
    }
  )
)
