import { Moon, Sun } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'

function ThemeToggle() {
  const isDark = useThemeStore((state) => state.isDark)
  const toggleTheme = useThemeStore((state) => state.toggleTheme)

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="rounded-lg p-2.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent-primary)]"
    >
      {isDark ? <Sun size={19} className="transition-transform duration-300" /> : <Moon size={19} className="transition-transform duration-300" />}
    </button>
  )
}

export default ThemeToggle
