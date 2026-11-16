import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import Sidebar from '../components/layout/Sidebar'
import { useAuthStore } from '../store/authStore'

function ScrollProgress() {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement
      const max = el.scrollHeight - el.clientHeight
      setWidth(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return <div id="scroll-progress" style={{ width: `${width}%` }} aria-hidden="true" />
}

function AppLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const token = useAuthStore((state) => state.token)
  const checkSession = useAuthStore((state) => state.checkSession)

  // Expired access tokens refresh silently; only dead sessions bounce to login
  // (network errors keep the current session so offline work continues).
  useEffect(() => {
    if (!token) return
    let cancelled = false
    checkSession().then((ok) => {
      if (!cancelled && !ok) navigate('/login', { replace: true })
    })
    return () => { cancelled = true }
  }, [pathname, token, checkSession, navigate])

  return (
    <div className="flex min-h-screen bg-[#0a0f1e]">
      <ScrollProgress />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="aurora absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-[#f59e0b]/[0.1] blur-3xl" />
        <div className="aurora-slow absolute -bottom-40 right-[10%] h-[30rem] w-[30rem] rounded-full bg-[#ea580c]/[0.08] blur-3xl" />
      </div>
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenuClick={() => setIsSidebarOpen(true)} />
        <main className="flex-1"><div key={pathname} className="page-enter"><Outlet /></div></main>
      </div>
    </div>
  )
}

export default AppLayout
