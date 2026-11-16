import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { initialProjects } from '../data/projectsData.js'
import { projectsApi, isBackendUnreachable, isMockToken } from '../services/api.js'
import { useAuthStore, registerProjectResetHandler } from './authStore.js'

export const useProjectsStore = create(
  persist(
    (set, get) => ({
      projects: initialProjects,
      isLoading: false,
      loadError: '',
      source: 'local',

      setProjects: (projects) => set({ projects: Array.isArray(projects) ? projects : [] }),

      resetProjects: (fallback = []) => {
        set({
          projects: Array.isArray(fallback) ? fallback : [],
          isLoading: false,
          loadError: '',
          source: 'local',
        })
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('ai-assistant-projects')
          }
        } catch {}
      },

      loadProjects: async () => {
        const token = useAuthStore.getState().token
        if (isMockToken(token)) {
          set({ source: 'local', loadError: '' })
          return get().projects
        }
        set({ isLoading: true, loadError: '' })
        try {
          const data = await projectsApi.list(token)
          const persistent = (Array.isArray(data.projects) ? data.projects : []).map((p) => ({ ...p, isDemo: false }))
          const rawDemos = Array.isArray(data.demoProjects) && data.demoProjects.length > 0 ? data.demoProjects : initialProjects
          const demos = rawDemos.map((p) => ({ ...p, isDemo: true }))

          const persistentIds = new Set(persistent.map((p) => p.id))
          const safeDemos = demos.filter((d) => !persistentIds.has(d.id))
          const projects = [...persistent, ...safeDemos]

          set({ projects, isLoading: false, source: 'api', loadError: '' })
          return projects
        } catch (err) {
          if (isBackendUnreachable(err)) {
            set({ isLoading: false, source: 'local', loadError: '' })
            return get().projects
          }
          set({
            isLoading: false,
            loadError: err.message || 'Could not load projects.',
            source: 'local',
          })
          return get().projects
        }
      },

      addProject: (project) => set((state) => ({ projects: [project, ...state.projects] })),

      createProject: async (payload) => {
        const currentUser = useAuthStore.getState().user
        const token = useAuthStore.getState().token
        const localProject = {
          ...payload,
          id:
            payload.id ||
            `${String(payload.name || 'project')
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'project'}-${
              typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID().slice(0, 8)
                : Date.now()
            }`,
          owner: payload.owner || currentUser?.name || currentUser?.fullName || 'You',
          ownerEmail: payload.ownerEmail || currentUser?.email || null,
          teamSize: payload.teamSize ?? 1,
          updated: payload.updated || 'Just now',
          created: payload.created || new Date().toDateString(),
          progress: payload.progress ?? 0,
          isDemo: false,
        }

        if (isMockToken(token)) {
          get().addProject(localProject)
          return { project: localProject, source: 'local' }
        }

        try {
          const data = await projectsApi.create(token, {
            name: payload.name,
            description: payload.description,
            stack: payload.stack,
            status: payload.status || 'Active',
          })
          const project = { ...(data.project || localProject), isDemo: false }
          get().addProject(project)
          set({ source: 'api' })
          return { project, source: 'api' }
        } catch (err) {
          if (isBackendUnreachable(err)) {
            get().addProject(localProject)
            return { project: localProject, source: 'local', fallback: true }
          }
          throw err
        }
      },

      fetchProject: async (id) => {
        const token = useAuthStore.getState().token
        if (isMockToken(token)) {
          const found = get().projects.find((project) => project.id === id)
          return found || null
        }
        set({ isLoading: true, loadError: '' })
        try {
          const data = await projectsApi.get(token, id)
          if (data?.project) {
            set((state) => {
              const existingIndex = state.projects.findIndex((p) => p.id === id)
              const updated =
                existingIndex >= 0
                  ? state.projects.map((p, idx) => (idx === existingIndex ? data.project : p))
                  : [data.project, ...state.projects]
              return { projects: updated, isLoading: false, source: 'api', loadError: '' }
            })
            return data.project
          }
          return null
        } catch (err) {
          if (isBackendUnreachable(err)) {
            set({ isLoading: false })
            const found = get().projects.find((project) => project.id === id)
            return found || null
          }
          if (err?.status === 404) {
            // Check if it's one of the initial demo projects before purging
            const demoFallback = initialProjects.find((p) => p.id === id)
            if (demoFallback) {
              set({ isLoading: false, loadError: '' })
              return demoFallback
            }
            // Server confirmed project does not exist: purge stale cache
            set((state) => ({
              projects: state.projects.filter((p) => p.id !== id),
              isLoading: false,
              loadError: '',
            }))
            const notFoundErr = new Error(err.message || 'Project not found')
            notFoundErr.status = 404
            notFoundErr.code = 'not_found'
            throw notFoundErr
          }
          set({ isLoading: false, loadError: err.message || 'Could not load the project.' })
          throw err
        }
      },

      updateProject: async (id, patch) => {
        const previous = get().projects
        const target = previous.find((p) => p.id === id)
        if (target?.isDemo) {
          const err = new Error('Predefined demo projects cannot be modified')
          err.status = 403
          throw err
        }

        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id ? { ...project, ...patch, updated: 'Just now' } : project
          ),
        }))
        const token = useAuthStore.getState().token
        if (isMockToken(token)) return { source: 'local' }
        try {
          const data = await projectsApi.update(token, id, patch)
          if (data.project) {
            set((state) => ({
              projects: state.projects.map((project) => (project.id === id ? data.project : project)),
            }))
          }
          return { source: 'api' }
        } catch (err) {
          if (isBackendUnreachable(err)) return { source: 'local', fallback: true }
          set({ projects: previous })
          throw err
        }
      },

      removeProject: async (id) => {
        const previous = get().projects
        const target = previous.find((p) => p.id === id)
        if (target?.isDemo) {
          const err = new Error('Predefined demo projects cannot be deleted')
          err.status = 403
          throw err
        }

        set((state) => ({ projects: state.projects.filter((project) => project.id !== id) }))
        const token = useAuthStore.getState().token
        if (isMockToken(token)) return { source: 'local' }
        try {
          await projectsApi.remove(token, id)
          return { source: 'api' }
        } catch (err) {
          if (isBackendUnreachable(err)) return { source: 'local', fallback: true }
          set({ projects: previous })
          throw err
        }
      },
    }),
    {
      name: 'ai-assistant-projects',
      partialize: (state) => ({ projects: state.projects }),
    }
  )
)

if (typeof registerProjectResetHandler === 'function') {
  registerProjectResetHandler(() => {
    useProjectsStore.getState().resetProjects([])
  })
}
