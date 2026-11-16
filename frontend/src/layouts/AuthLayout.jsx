import { ArrowLeft } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import Logo from '../components/Logo'

function AuthLayout() {
  const { pathname } = useLocation()
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-[#eef1f8] lg:grid lg:grid-cols-[minmax(280px,0.8fr)_minmax(460px,1.2fr)]">
      <aside className="relative hidden overflow-hidden bg-[#0c1226] p-10 text-[#f2f4fa] lg:flex lg:flex-col lg:justify-between">
        <div className="blob absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#f59e0b]/25 blur-3xl" />
        <div className="blob-slow absolute -bottom-36 -left-20 h-96 w-96 rounded-full bg-[#fbbf24]/15 blur-3xl" />
        <div className="bg-grid absolute inset-0 opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#f59e0b]/10 via-transparent to-[#0c1226]" />
        <NavLink to="/login" className="animate-fade-in relative flex items-center gap-3">
          <Logo size={40} iconSize={22} />
          <span className="text-sm font-bold leading-tight">DevNexus AI<span className="block text-xs font-normal text-[#9aa5c0]">Software workspace</span></span>
        </NavLink>
        <div className="relative max-w-sm pb-8">
          <p className="animate-fade-up mb-5 text-xs font-bold uppercase tracking-[0.24em] text-[#fcd34d]" style={{ animationDelay: '0.1s' }}>Build with clarity</p>
          <h1 className="animate-fade-up text-4xl font-bold leading-tight tracking-tight" style={{ animationDelay: '0.2s' }}>Your codebase, <span className="greeting-name">understood.</span></h1>
          <p className="animate-fade-up mt-5 text-base leading-7 text-[#9aa5c0]" style={{ animationDelay: '0.3s' }}>A focused workspace for the thinking, building, and shipping behind modern software.</p>
        </div>
        <p className="animate-fade-in relative text-xs text-[#9aa5c0]" style={{ animationDelay: '0.4s' }}>DevNexus AI – Intelligent Software Engineering Platform</p>
      </aside>
      <main className="flex min-h-screen flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div key={pathname} className="page-enter w-full max-w-md">
          <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-xs font-bold text-[#8f99b0] transition-colors hover:text-[#eef1f8]">
            <ArrowLeft size={14} /> Back to home
          </Link>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default AuthLayout
