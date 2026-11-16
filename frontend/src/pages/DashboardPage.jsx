import { BarChart3, BriefcaseBusiness, CheckSquare, FileText, FolderKanban, Plus, ScanSearch, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useProjectsStore } from '../store/projectsStore'
import { useTasksStore } from '../store/tasksStore'
import { useTeamStore } from '../store/teamStore'
import { insightsApi, securityApi, isMockToken } from '../services/api'
import Reveal from '../components/Reveal'
import AIOverview from '../components/dashboard/AIOverview'
import ProjectHealth from '../components/dashboard/ProjectHealth'
import RecentActivity from '../components/dashboard/RecentActivity'
import RecentProjects from '../components/dashboard/RecentProjects'
import ReviewSecuritySummary from '../components/dashboard/ReviewSecuritySummary'
import StatCard from '../components/dashboard/StatCard'
import TaskProgress from '../components/dashboard/TaskProgress'
import {
  activities,
  aiOverview,
  reviewSummary,
  securitySummary,
} from '../data/dashboardData'

const activityIcons = {
  project: FolderKanban,
  task: CheckSquare,
  sprint: ScanSearch,
  review: ScanSearch,
  docs: FileText,
  ai: BarChart3,
  team: Users,
  report: FileText,
  security: ShieldCheck,
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return 'Just now'
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const projects = useProjectsStore((s) => s.projects)
  const loadProjects = useProjectsStore((s) => s.loadProjects)
  const tasks = useTasksStore((s) => s.tasks)
  const loadTasks = useTasksStore((s) => s.loadTasks)
  const members = useTeamStore((s) => s.members)
  const loadMembers = useTeamStore((s) => s.loadMembers)
  const displayName = user?.name || user?.email?.split('@')[0] || 'there'

  const [liveOverview, setLiveOverview] = useState(null)
  const [liveReview, setLiveReview] = useState(null)
  const [liveSecurity, setLiveSecurity] = useState(null)
  const [liveActivities, setLiveActivities] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    loadProjects()
    loadTasks()
    loadMembers()
  }, [loadProjects, loadTasks, loadMembers])

  useEffect(() => {
    const token = useAuthStore.getState().token
    if (isMockToken(token)) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setLoadError('')
      try {
        const [dash, summary, security] = await Promise.all([
          insightsApi.dashboard(token),
          insightsApi.reportsSummary(token),
          securityApi.findings(token),
        ])
        if (cancelled) return
        const findings = Array.isArray(security.findings) ? security.findings : []
        const openSecurity = findings.filter((f) => f.status === 'Open')
        const medium = findings.filter((f) => f.severity === 'Medium').length
        setLiveOverview([
          { label: 'Code Reviews', value: String(summary.reviews?.total ?? 0) },
          { label: 'Documents Generated', value: String(summary.documents?.total ?? 0) },
          { label: 'Open Tasks', value: String(dash.stats?.openTasks ?? 0) },
          { label: 'Critical Findings', value: String(dash.stats?.criticalHighFindings ?? 0) },
        ])
        setLiveReview({
          reviews: `${summary.reviews?.total ?? 0} reviews completed`,
          suggestions: `${summary.documents?.total ?? 0} documents generated`,
          attention: `${dash.stats?.openTasks ?? 0} open tasks need attention`,
        })
        setLiveSecurity({
          findings: `${findings.length} total findings`,
          high: `${dash.stats?.criticalHighFindings ?? 0} critical/high`,
          medium: `${medium} medium · ${openSecurity.length} open`,
        })
        const feed = await insightsApi.activity(token, 5)
        if (cancelled) return
        setLiveActivities(
          (feed.activity || []).map((entry) => ({
            label: entry.message,
            time: timeAgo(entry.createdAt),
            icon: activityIcons[entry.type] || BarChart3,
          }))
        )
      } catch (err) {
        if (!cancelled) {
          setLoadError(err.message || 'Failed to load dashboard data')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const recentProjects = useMemo(
    () =>
      projects.slice(0, 3).map((project) => ({
        name: project.name,
        stack: (project.stack || []).join('  ·  ') || 'Stack TBD',
        status: project.status,
        updated: project.updated ? `Updated ${project.updated}` : 'Updated recently',
        icon: (project.name || 'PR')
          .split(' ')
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase(),
      })),
    [projects]
  )

  const taskProgress = useMemo(() => {
    const completed = tasks.filter((t) => t.status === 'Done').length
    const inProgress = tasks.filter((t) => t.status === 'In Progress').length
    const todo = tasks.filter((t) => t.status === 'Todo').length
    const total = tasks.length || 1
    return {
      completed,
      inProgress,
      todo,
      completion: Math.round((completed / total) * 100),
    }
  }, [tasks])

  const taskList = useMemo(
    () =>
      tasks.slice(0, 5).map((task) => ({
        label: task.title,
        status: task.status,
      })),
    [tasks]
  )

  const dashboardStats = useMemo(() => {
    const activeProjects = projects.filter((p) => p.status === 'Active').length
    const pendingTasks = tasks.filter((t) => t.status !== 'Done').length
    const activeMembers = members.filter((m) => m.status === 'Active').length
    return [
      { label: 'Total Projects', value: String(projects.length), detail: `${activeProjects} active`, icon: FolderKanban },
      { label: 'Active Projects', value: String(activeProjects), detail: 'Across your workspace', icon: BriefcaseBusiness },
      { label: 'Team Members', value: String(members.length), detail: `${activeMembers} active`, icon: Users },
      { label: 'Pending Tasks', value: String(pendingTasks), detail: `${taskProgress.completed} completed`, icon: CheckSquare },
    ]
  }, [projects, tasks, members, taskProgress.completed])

  const projectHealth = useMemo(() => {
    const totalProjects = projects.length || 1
    const activeProjects = projects.filter((p) => p.status === 'Active').length
    const totalTasks = tasks.length || 1
    const completedTasks = tasks.filter((t) => t.status === 'Done').length
    const inProgressTasks = tasks.filter((t) => t.status === 'In Progress').length
    const highPriorityTasks = tasks.filter((t) => t.priority === 'High' && t.status !== 'Done').length
    const totalMembers = members.length || 1
    const activeMembers = members.filter((m) => m.status === 'Active').length

    const codeQuality = Math.min(100, Math.round(60 + (activeProjects / totalProjects) * 20 + (completedTasks / totalTasks) * 20))
    const taskCompletion = Math.round((completedTasks / totalTasks) * 100)
    const documentation = Math.min(100, Math.round(40 + (activeProjects / totalProjects) * 30 + (completedTasks / totalTasks) * 30))
    const securityReview = Math.min(100, Math.round(50 + (activeMembers / totalMembers) * 30 + (1 - highPriorityTasks / Math.max(totalTasks, 1)) * 20))

    return [
      { label: 'Code Quality', value: codeQuality },
      { label: 'Task Completion', value: taskCompletion },
      { label: 'Documentation', value: documentation },
      { label: 'Security Review', value: securityReview },
    ]
  }, [projects, tasks, members])

  return (
    <section className="page-enter mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 lg:py-10">
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="animate-fade-in mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">Overview</p>
          <h2 className="greeting-heading text-3xl font-bold tracking-tight text-[#eef1f8] sm:text-4xl">
            Welcome back, <span className="greeting-name">{displayName}</span>
          </h2>
          <p className="animate-fade-up mt-2 text-sm text-[#8f99b0] sm:text-base" style={{ animationDelay: '0.15s' }}>
            Here is what is happening across your engineering workspace.
          </p>
        </div>
        <Link
          to="/projects"
          className="btn-press btn-shine animate-scale-in inline-flex w-fit items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] transition hover:bg-[#fbbf24] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/20"
          style={{ animationDelay: '0.2s' }}
        >
          <Plus size={17} /> New Project
        </Link>
      </div>

      {isLoading && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#232c4b] bg-[#121a2e] px-4 py-3 text-sm text-[#8f99b0]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#f59e0b] border-t-transparent" />
          Loading dashboard data...
        </div>
      )}

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {loadError}
        </div>
      )}

      <div className="animate-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <Reveal className="mt-8">
        <AIOverview items={liveOverview || aiOverview} />
      </Reveal>

      <Reveal className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <RecentProjects projects={recentProjects} />
        <TaskProgress progress={taskProgress} tasks={taskList} />
      </Reveal>

      <Reveal className="mt-8">
        <ReviewSecuritySummary review={liveReview || reviewSummary} security={liveSecurity || securitySummary} />
      </Reveal>

      <Reveal className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <RecentActivity activities={liveActivities || activities} />
        <ProjectHealth health={projectHealth} />
      </Reveal>
    </section>
  )
}

export default DashboardPage
