import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useThemeStore = create(
  persist(
    (set, get) => ({
      isDark: true,
      toggleTheme: () => {
        const next = !get().isDark
        set({ isDark: next })
        applyThemeClass(next)
      },
      setTheme: (isDark) => {
        set({ isDark })
        applyThemeClass(isDark)
      },
    }),
    {
      name: 'ai-assistant-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyThemeClass(state.isDark)
      },
    }
  )
)

export function applyThemeClass(isDark) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.classList.toggle('light', !isDark)
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
  if (document.documentElement.style) {
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  }
}

if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('ai-assistant-theme')
  if (stored) {
    try {
      const parsed = JSON.parse(stored)
      const isDark = parsed?.state?.isDark ?? true
      applyThemeClass(isDark)
    } catch {
      applyThemeClass(true)
    }
  } else {
    applyThemeClass(true)
  }
}
