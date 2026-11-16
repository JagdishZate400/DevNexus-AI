import { LogOut, X } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import Logo from '../Logo'
import { navigationItems } from '../../data/navigation'
import { useAuthStore } from '../../store/authStore'

function Sidebar({ isOpen, onClose }) {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    onClose?.()
    navigate('/login', { replace: true })
  }
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-[#05070f]/45 transition-opacity lg:hidden ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-[#232c4b] bg-[#0b1122] transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-20 items-center justify-between border-b border-[#232c4b] px-6">
          <NavLink to="/dashboard" className="flex items-center gap-3" onClick={onClose}>
            <Logo size={36} iconSize={20} />
            <span className="text-sm font-bold leading-tight tracking-tight text-[#eef1f8]">
              DevNexus AI
              <span className="block text-xs font-normal text-[#8f99b0]">Software workspace</span>
            </span>
          </NavLink>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-[#8f99b0] hover:bg-[#1a2340] lg:hidden" aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-6" aria-label="Main navigation">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[#8f99b0]">Workspace</p>
          {navigationItems.map(({ label, path, icon: Icon }, index) => (
            <NavLink
              key={path}
              to={path}
              onClick={onClose}
              style={{ animationDelay: `${index * 35}ms` }}
              className={({ isActive }) => `nav-enter flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${isActive ? 'bg-[#2b2314] font-semibold text-[#eef1f8] shadow-[inset_2px_0_0_#f59e0b]' : 'text-[#8f99b0] hover:translate-x-0.5 hover:bg-[#1a2340] hover:text-[#eef1f8]'}`}
            >
              <Icon size={18} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[#232c4b] p-4">
          <div className="flex items-center gap-3 rounded-lg bg-[#1a2340] px-3 py-3">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f59e0b] text-sm font-bold text-[#231303]">{(user?.name?.[0] || user?.email?.[0] || 'U').toUpperCase()}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-[#eef1f8]">{user?.name || user?.email?.split('@')[0] || 'User'}</p>
              <p className="text-xs text-[#8f99b0]">{user?.role || 'Developer'}</p>
            </div>
            <button type="button" onClick={handleLogout} title="Sign out" aria-label="Sign out" className="rounded-md p-2 text-[#8f99b0] hover:bg-[#2b2314]">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

export default Sidebar
