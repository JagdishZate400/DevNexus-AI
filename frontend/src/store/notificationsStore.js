import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Read/unread state for header notifications. Only the read ids are
// persisted — the notification list itself is static workspace data, so
// newly added notifications always show up as unread.
export const useNotificationsStore = create(
  persist(
    (set, get) => ({
      readIds: [],
      isRead: (id) => get().readIds.includes(id),
      unreadCount: (ids) => ids.filter((id) => !get().readIds.includes(id)).length,
      markAsRead: (id) =>
        set((state) => (state.readIds.includes(id) ? state : { readIds: [...state.readIds, id] })),
      markAllAsRead: (ids) =>
        set((state) => {
          const next = new Set(state.readIds)
          ids.forEach((id) => next.add(id))
          return { readIds: [...next] }
        }),
    }),
    { name: 'ai-assistant-notifications' }
  )
)
