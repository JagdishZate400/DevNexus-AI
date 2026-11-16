import { useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Bug,
  ClipboardList,
  Code2,
  FileText,
  MessagesSquare,
  Rocket,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import Reveal from '../components/Reveal'
import Logo from '../components/Logo'
import { useCountUp } from '../hooks/useCountUp'
import { useAuthStore } from '../store/authStore'

const stack = ['React', 'Node.js', 'PostgreSQL', 'Python', 'FastAPI', 'TypeScript']

const features = [
  {
    icon: MessagesSquare,
    title: 'Project-aware AI chat',
    description: 'Ask questions about your actual codebase and get answers grounded in your files with RAG retrieval.',
  },
  {
    icon: Code2,
    title: 'AI code review',
    description: 'Review quality, maintainability, and improvement opportunities before every merge.',
  },
  {
    icon: Bug,
    title: 'Bug detection',
    description: 'Surface potential bugs early with AI analysis across your workspace projects.',
  },
  {
    icon: ShieldCheck,
    title: 'Security analysis',
    description: 'Scan for vulnerabilities by severity so critical issues never slip through.',
  },
  {
    icon: FileText,
    title: 'Documentation generation',
    description: 'Turn source code into clear, searchable docs your whole team can use.',
  },
  {
    icon: ClipboardList,
    title: 'Tasks & sprints',
    description: 'Track work, plan sprints, and follow activity from the same workspace.',
  },
]

const steps = [
  {
    icon: Upload,
    number: '01',
    title: 'Bring your project',
    description: 'Create a project and explore its structure, files, and dependencies in the workspace.',
  },
  {
    icon: MessagesSquare,
    number: '02',
    title: 'Ask & analyze',
    description: 'Chat with your codebase, run AI reviews, and scan for bugs and security findings.',
  },
  {
    icon: Rocket,
    number: '03',
    title: 'Review, fix & ship',
    description: 'Act on suggestions, track tasks through sprints, and ship with confidence.',
  },
]

function HeroStat({ value, label }) {
  const displayValue = useCountUp(value)
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums text-white">{displayValue}</dd>
      <dd className="mt-1 text-xs text-[#8f99b0]">{label}</dd>
    </div>
  )
}

function LandingPage() {
  const user = useAuthStore((state) => state.user)
  const cardRef = useRef(null)

  function handleTilt(event) {
    const node = cardRef.current
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const rect = node.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width - 0.5
    const y = (event.clientY - rect.top) / rect.height - 0.5
    node.style.transform = `perspective(900px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg)`
  }

  function resetTilt() {
    if (cardRef.current) cardRef.current.style.transform = ''
  }

  function handleCardSpotlight(event) {
    const node = event.currentTarget
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const rect = node.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width
    const py = (event.clientY - rect.top) / rect.height
    node.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`)
    node.style.setProperty('--my', `${(py * 100).toFixed(1)}%`)
    node.style.transform = `perspective(800px) rotateX(${((0.5 - py) * 6).toFixed(2)}deg) rotateY(${((px - 0.5) * 8).toFixed(2)}deg) translateY(-4px)`
  }

  function resetCardSpotlight(event) {
    event.currentTarget.style.transform = ''
  }

  return (
    <div className="page-enter min-h-screen bg-[#0a0f1e] text-[#eef1f8]">
      {/* ---------- Top navigation ---------- */}
      <header className="animate-fade-in sticky top-0 z-50 border-b border-[#232c4b] bg-[#0a0f1e]/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link to="/" className="flex items-center gap-3">
            <Logo size={36} iconSize={20} />
            <span className="text-sm font-bold leading-tight tracking-tight">
              DevNexus AI
              <span className="block text-xs font-normal text-[#8f99b0]">Software workspace</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-[#8f99b0] md:flex" aria-label="Introduction">
            <a href="#features" className="link-underline transition-colors hover:text-[#eef1f8]">Features</a>
            <a href="#how-it-works" className="link-underline transition-colors hover:text-[#eef1f8]">How it works</a>
            <a href="#stack" className="link-underline transition-colors hover:text-[#eef1f8]">Stack</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            {user ? (
              <Link to="/dashboard" className="btn-press btn-shine inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-2.5 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24]">
                Open Dashboard <ArrowRight size={15} />
              </Link>
            ) : (
              <>
                <Link to="/login" className="rounded-lg px-3 py-2.5 text-sm font-bold text-[#b9c2d6] transition hover:bg-[#1a2340] hover:text-white">
                  Sign in
                </Link>
                <Link to="/register" className="btn-press btn-shine inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-2.5 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24]">
                  Get started <ArrowRight size={15} />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden">
        <div className="aurora absolute -left-32 top-10 h-96 w-96 rounded-full bg-[#f59e0b]/20 blur-3xl" />
        <div className="aurora-slow absolute -right-32 top-64 h-[28rem] w-[28rem] rounded-full bg-[#ea580c]/15 blur-3xl" />
        <div className="aurora absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-[#f43f5e]/10 blur-3xl" style={{ animationDelay: '-6s' }} />
        <div className="bg-grid absolute inset-0 opacity-50" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-14 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-24">
          <div>
            <p className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-[#2b3558] bg-[#121a2e]/80 px-3.5 py-1.5 text-xs font-bold text-[#fcd34d]">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-[#34d399]" />
              <Sparkles size={13} /> AI-powered engineering workspace
            </p>
            <h1 className="animate-fade-up mt-6 text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl" style={{ animationDelay: '0.1s' }}>
              Understand, review, and <span className="greeting-name">ship better code.</span>
            </h1>
            <p className="animate-fade-up mt-6 max-w-xl text-base leading-7 text-[#8f99b0] sm:text-lg sm:leading-8" style={{ animationDelay: '0.2s' }}>
              DevNexus AI is your repository-aware assistant. Chat with your codebase, catch bugs,
              review security, and generate docs — all from one workspace.
            </p>
            <div className="animate-fade-up mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: '0.3s' }}>
              {user ? (
                <Link to="/dashboard" className="btn-press btn-shine inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-6 py-3.5 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24]">
                  Open Dashboard <ArrowRight size={16} />
                </Link>
              ) : (
                <>
                  <Link to="/register" className="btn-press btn-shine inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-6 py-3.5 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24]">
                    Start building free <ArrowRight size={16} />
                  </Link>
                  <Link to="/login" className="inline-flex items-center gap-2 rounded-lg border border-[#2b3558] bg-[#121a2e]/70 px-6 py-3.5 text-sm font-bold text-[#dbe2ef] transition hover:border-[#f59e0b] hover:bg-[#1a2340]">
                    Sign in
                  </Link>
                </>
              )}
            </div>
            <dl className="animate-fade-up mt-10 flex flex-wrap gap-x-10 gap-y-4" style={{ animationDelay: '0.4s' }}>
              {[
                ['18', 'AI analyses completed'],
                ['9', 'Code reviews run'],
                ['0', 'Critical issues open'],
              ].map(([value, label]) => <HeroStat key={label} value={value} label={label} />)}
            </dl>
          </div>

          {/* Floating product visual — AI chat mockup */}
          <div className="relative mx-auto w-full max-w-md lg:max-w-none" onMouseMove={handleTilt} onMouseLeave={resetTilt}>
            <div ref={cardRef} className="transition-transform duration-200 ease-out">
            <div className="animate-scale-in rounded-2xl border border-[#232c4b] bg-[#121a2e]/90 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur" style={{ animationDelay: '0.25s' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Logo size={32} iconSize={18} className="rounded-full" />
                  <div>
                    <p className="text-xs font-bold text-[#eef1f8]">DevNexus AI</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-[#34d399]"><span className="pulse-dot h-1 w-1 rounded-full bg-[#34d399]" /> Online · jobflow</p>
                  </div>
                </div>
                <span className="rounded-full bg-[#1a2340] px-2.5 py-1 text-[10px] font-bold text-[#fcd34d]">RAG grounded</span>
              </div>
              <div className="animate-stagger mt-4 space-y-3">
                <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-[#f59e0b] px-3.5 py-2.5 text-xs leading-5 text-[#231303]">
                  Why is the Greenhouse redirect failing?
                </div>
                <div className="w-fit max-w-[92%] rounded-xl rounded-bl-sm bg-[#1a2340] px-3.5 py-2.5 text-xs leading-5 text-[#dbe2ef]">
                  The <span className="font-mono text-[#fbbf24]">state</span> param is dropped on the ATS redirect step. I added a fallback handler — run the tests to verify.
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['redirect.ts', 'ats-config.ts', '+1 more'].map((source) => (
                    <span key={source} className="inline-flex items-center gap-1 rounded-md border border-[#2b3558] bg-[#0e1428] px-2 py-1 text-[10px] font-semibold text-[#34d399]"><FileText size={11} /> {source}</span>
                  ))}
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#2b3558] bg-[#0e1428] px-3.5 py-2.5">
                <p className="flex-1 text-xs text-[#8f99b0]">Ask about your project…</p>
                <span className="inline-flex items-center gap-1 text-[#34d399]" aria-hidden="true"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>
              </div>
            </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Stack strip ---------- */}
      <section id="stack" className="border-y border-[#232c4b] bg-[#0c1226]/60">
        <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
          <Reveal>
            <p className="text-center text-xs font-bold uppercase tracking-[0.24em] text-[#8f99b0]">Works with your stack</p>
          </Reveal>
          <Reveal delay={100}>
            <div className="marquee-mask mt-6 overflow-hidden">
              <div className="marquee flex w-max items-center gap-3">
                {stack.map((tech) => (
                  <span key={tech} className="rounded-full border border-[#2b3558] bg-[#121a2e] px-5 py-2.5 text-sm font-bold text-[#b9c2d6]">
                    {tech}
                  </span>
                ))}
                {stack.map((tech) => (
                  <span key={`dup-${tech}`} aria-hidden="true" className="rounded-full border border-[#2b3558] bg-[#121a2e] px-5 py-2.5 text-sm font-bold text-[#b9c2d6]">
                    {tech}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section id="features" className="relative">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#fbbf24]">Platform</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Everything you need to ship with confidence</h2>
            <p className="mt-4 text-sm leading-7 text-[#8f99b0] sm:text-base">One workspace for understanding code, catching issues, and coordinating the team.</p>
          </Reveal>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" style={{ perspective: '1200px' }}>
            {features.map(({ icon: Icon, title, description }, index) => (
              <Reveal key={title} delay={(index % 3) * 100 + Math.floor(index / 3) * 80}>
                <article
                  onMouseMove={handleCardSpotlight}
                  onMouseLeave={resetCardSpotlight}
                  className="spotlight-card card-glow group relative h-full overflow-hidden rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6 will-change-transform"
                  style={{ transition: 'transform 0.2s ease-out, border-color 0.25s ease, box-shadow 0.25s ease' }}
                >
                  <span className="card-sheen" aria-hidden="true" />
                  <span className="feature-icon relative grid h-11 w-11 place-items-center rounded-xl bg-[#1a2340] text-[#34d399] transition-all duration-300 group-hover:scale-110 group-hover:bg-[#f59e0b] group-hover:text-[#231303] group-hover:shadow-[0_0_24px_rgba(245,158,11,0.5)]">
                    <Icon size={20} className="transition-transform duration-300 group-hover:-rotate-12 group-hover:scale-110" />
                  </span>
                  <span className="feature-glow" aria-hidden="true" />
                  <h3 className="relative mt-5 font-bold text-[#eef1f8] transition-colors duration-300 group-hover:text-[#fcd34d]">{title}</h3>
                  <p className="relative mt-2 text-sm leading-6 text-[#8f99b0]">{description}</p>
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-[#f59e0b] via-[#fbbf24] to-transparent transition-transform duration-500 ease-out group-hover:scale-x-100" aria-hidden="true" />
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how-it-works" className="border-y border-[#232c4b] bg-[#0c1226]/60">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#fcd34d]">How it works</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">From first commit to confident release</h2>
          </Reveal>
          <div className="relative mt-12 grid gap-5 md:grid-cols-3" style={{ perspective: '1200px' }}>
            <span className="step-connector hidden md:block" aria-hidden="true" />
            {steps.map(({ icon: Icon, number, title, description }, index) => (
              <Reveal key={title} delay={index * 120}>
                <article
                  onMouseMove={handleCardSpotlight}
                  onMouseLeave={resetCardSpotlight}
                  className="spotlight-card card-glow group relative h-full overflow-hidden rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6 will-change-transform"
                  style={{ transition: 'transform 0.2s ease-out, border-color 0.25s ease, box-shadow 0.25s ease' }}
                >
                  <span className="card-sheen" aria-hidden="true" />
                  <span className="step-number pointer-events-none absolute -right-2 -top-4 select-none text-7xl font-bold text-[#232c4b] transition-colors duration-300 group-hover:text-[#f59e0b]/25" aria-hidden="true">{number}</span>
                  <span className="relative grid h-11 w-11 place-items-center rounded-xl bg-[#2b2314] text-[#fcd34d] transition-all duration-300 group-hover:rotate-6 group-hover:scale-110 group-hover:shadow-[0_0_24px_rgba(245,158,11,0.45)]">
                    <Icon size={20} className="transition-transform duration-300 group-hover:scale-110" />
                  </span>
                  <h3 className="relative mt-5 font-bold text-[#eef1f8] transition-colors duration-300 group-hover:text-[#fcd34d]">{title}</h3>
                  <p className="relative mt-2 text-sm leading-6 text-[#8f99b0]">{description}</p>
                  <span className="relative mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-[#f59e0b] opacity-0 transition-all duration-300 group-hover:opacity-100" aria-hidden="true">
                    <span className="step-pulse h-1.5 w-1.5 rounded-full bg-[#f59e0b]" />
                    Step {index + 1} of {steps.length}
                  </span>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- CTA band ---------- */}
      <section>
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-[#2b3558] bg-[#0c1226] px-6 py-14 text-center sm:px-12">
              <div className="aurora absolute -left-20 -top-20 h-64 w-64 rounded-full bg-[#f59e0b]/25 blur-3xl" />
              <div className="aurora-slow absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-[#ea580c]/20 blur-3xl" />
              <div className="bg-grid absolute inset-0 opacity-50" />
              <div className="relative">
                <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">Ready to understand your codebase?</h2>
                <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[#8f99b0] sm:text-base">Create a free account, open your first project, and let AI do the heavy lifting.</p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  {user ? (
                    <Link to="/dashboard" className="btn-press btn-shine inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-6 py-3.5 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24]">
                      Open Dashboard <ArrowRight size={16} />
                    </Link>
                  ) : (
                    <>
                      <Link to="/register" className="btn-press btn-shine inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-6 py-3.5 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24]">
                        Create free account <ArrowRight size={16} />
                      </Link>
                      <Link to="/login" className="inline-flex items-center gap-2 rounded-lg border border-[#2b3558] bg-[#121a2e]/70 px-6 py-3.5 text-sm font-bold text-[#dbe2ef] transition hover:border-[#f59e0b] hover:bg-[#1a2340]">
                        Sign in
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="border-t border-[#232c4b]">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-5 px-5 py-8 sm:flex-row sm:px-8">
          <div className="flex items-center gap-3">
            <Logo size={32} iconSize={18} />
            <span className="text-sm font-bold">DevNexus AI</span>
          </div>
          <nav className="flex items-center gap-6 text-sm font-medium text-[#8f99b0]" aria-label="Footer">
            <Link to="/login" className="link-underline transition-colors hover:text-[#eef1f8]">Sign in</Link>
            <Link to="/register" className="link-underline transition-colors hover:text-[#eef1f8]">Create account</Link>
            <Link to="/dashboard" className="link-underline transition-colors hover:text-[#eef1f8]">Dashboard</Link>
          </nav>
          <p className="text-xs text-[#8f99b0]">© 2026 DevNexus AI</p>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
