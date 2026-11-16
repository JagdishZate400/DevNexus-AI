import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { initialTasks } from '../data/tasksData'
import { tasksApi, isBackendUnreachable, isMockToken } from '../services/api'
import { useAuthStore } from './authStore'

function localTask(payload) {
  return {
    ...payload,
    id:
      payload.id ||
      `task-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
    createdAt: payload.createdAt || new Date().toISOString().slice(0, 10),
  }
}

export const useTasksStore = create(
  persist(
    (set, get) => ({
      tasks: initialTasks,
      isLoading: false,
      loadError: '',
      source: 'local',

      setTasks: (tasks) => set({ tasks }),

      loadTasks: async () => {
        const token = useAuthStore.getState().token
        if (isMockToken(token)) {
          set({ source: 'local', loadError: '' })
          return get().tasks
        }
        set({ isLoading: true, loadError: '' })
        try {
          const data = await tasksApi.list(token)
          const tasks = Array.isArray(data.tasks) ? data.tasks : []
          set({ tasks, isLoading: false, source: 'api', loadError: '' })
          return tasks
        } catch (err) {
          if (isBackendUnreachable(err)) {
            set({ isLoading: false, source: 'local', loadError: '' })
            return get().tasks
          }
          set({ isLoading: false, loadError: err.message || 'Could not load tasks.', source: 'local' })
          return get().tasks
        }
      },

      addTask: async (payload) => {
        const token = useAuthStore.getState().token
        if (isMockToken(token)) {
          const task = localTask(payload)
          set((state) => ({ tasks: [task, ...state.tasks] }))
          return { task, source: 'local' }
        }
        try {
          const data = await tasksApi.create(token, {
            title: payload.title,
            description: payload.description || '',
            status: payload.status || 'Todo',
            priority: payload.priority || 'Medium',
            assignee: payload.assignee || '',
            project: payload.project || '',
          })
          const task = data.task || localTask(payload)
          set((state) => ({ tasks: [task, ...state.tasks], source: 'api', loadError: '' }))
          return { task, source: 'api' }
        } catch (err) {
          if (isBackendUnreachable(err)) {
            const task = localTask(payload)
            set((state) => ({ tasks: [task, ...state.tasks] }))
            return { task, source: 'local', fallback: true }
          }
          throw err
        }
      },

      updateTaskStatus: async (id, status) => {
        const previous = get().tasks
        set((state) => ({
          tasks: state.tasks.map((task) => (task.id === id ? { ...task, status } : task)),
        }))
        const token = useAuthStore.getState().token
        if (isMockToken(token)) return { source: 'local' }
        try {
          const data = await tasksApi.update(token, id, { status })
          if (data.task) {
            set((state) => ({
              tasks: state.tasks.map((task) => (task.id === id ? data.task : task)),
            }))
          }
          return { source: 'api' }
        } catch (err) {
          if (isBackendUnreachable(err)) return { source: 'local', fallback: true }
          // Roll back optimistic update on real failures (e.g. 403/404).
          set({ tasks: previous })
          throw err
        }
      },
    }),
    {
      name: 'ai-assistant-tasks',
      partialize: (state) => ({ tasks: state.tasks }),
    }
  )
)
