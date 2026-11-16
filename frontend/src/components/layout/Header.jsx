import { useEffect, useRef, useState } from 'react'
import { Bell, LogOut, Menu, Search } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { navigationItems } from '../../data/navigation'
import { initialNotifications } from '../../data/notificationsData'
import { useAuthStore } from '../../store/authStore'
import { useNotificationsStore } from '../../store/notificationsStore'
import NotificationsPanel from './NotificationsPanel'
import SearchPalette from './SearchPalette'
import ThemeToggle from './ThemeToggle'

function Header({ onMenuClick }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const readIds = useNotificationsStore((state) => state.readIds)
  const markAsRead = useNotificationsStore((state) => state.markAsRead)
  const markAllAsRead = useNotificationsStore((state) => state.markAllAsRead)
  const currentPage = navigationItems.find((item) => item.path === pathname)
  const pageTitle = currentPage?.label ?? (pathname.startsWith('/projects') ? 'Projects' : 'Page not found')
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const notificationsRef = useRef(null)

  const notifications = initialNotifications.map((item) => ({ ...item, read: readIds.includes(item.id) }))
  const unreadCount = notifications.filter((item) => !item.read).length

  useEffect(() => {
    if (!notificationsOpen) return
    function handlePointerDown(event) {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) setNotificationsOpen(false)
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') setNotificationsOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [notificationsOpen])

  // Global search (Ctrl/⌘+K) across projects, tasks, sprints, people, pages.
  useEffect(() => {
    function handleShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', handleShortcut)
    return () => document.removeEventListener('keydown', handleShortcut)
  }, [])

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="animate-fade-in relative z-40 flex h-20 shrink-0 items-center justify-between border-b border-[#232c4b] bg-[#121a2e]/90 px-5 backdrop-blur sm:px-8">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onMenuClick} className="rounded-lg p-2 text-[#8f99b0] hover:bg-[#1a2340] lg:hidden" aria-label="Open navigation">
          <Menu size={21} />
        </button>
        <div>
          <p className="hidden text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f99b0] sm:block">Workspace</p>
          <h1 className="text-xl font-bold tracking-tight text-[#eef1f8]">{pageTitle}</h1>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-4">
        <ThemeToggle />
        <button type="button" title="Search workspace (Ctrl+K)" onClick={() => setSearchOpen(true)} className="rounded-lg p-2.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]" aria-label="Search">
          <Search size={19} />
        </button>
        <div ref={notificationsRef} className="relative">
          <button
            type="button"
            title="Notifications"
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            aria-haspopup="dialog"
            onClick={() => setNotificationsOpen((open) => !open)}
            className="group relative rounded-lg p-2.5 text-[#8f99b0] hover:bg-[#1a2340]"
          >
            <Bell size={19} className="transition-transform duration-300 group-hover:rotate-12" />
            {unreadCount > 0 && (
              <span className="pulse-dot absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#fbbf24] px-1 text-[9px] font-bold text-[#231303]">
                {unreadCount}
              </span>
            )}
          </button>
          {notificationsOpen && (
            <NotificationsPanel
              notifications={notifications}
              onSelect={(id) => markAsRead(id)}
              onMarkAllRead={() => markAllAsRead(notifications.map((item) => item.id))}
            />
          )}
        </div>
        <div className="hidden h-8 w-px bg-[#232c4b] sm:block" />
        <div className="hidden items-center gap-2 sm:flex">
          <span className="animate-pop-in grid h-8 w-8 place-items-center rounded-full bg-[#f59e0b] text-xs font-bold text-[#231303]">{(user?.name?.[0] || user?.email?.[0] || 'U').toUpperCase()}</span>
          <span className="text-sm font-semibold text-[#cdd6e8]">{user?.name || user?.email?.split('@')[0] || 'User'}</span>
          <button type="button" onClick={handleLogout} title="Sign out" aria-label="Sign out" className="rounded-lg p-2 text-[#8f99b0] hover:bg-[#1a2340]">
            <LogOut size={17} />
          </button>
        </div>
      </div>
      {searchOpen && <SearchPalette isOpen onClose={() => setSearchOpen(false)} />}
    </header>
  )
}

export default Header
