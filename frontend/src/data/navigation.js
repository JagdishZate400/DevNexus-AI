import {
  BarChart3,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  Code2,
  FolderKanban,
  Gauge,
  ListTodo,
  Settings,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react'

export const navigationItems = [
  { label: 'Dashboard', path: '/dashboard', icon: Gauge },
  { label: 'Projects', path: '/projects', icon: FolderKanban },
  { label: 'Workspace', path: '/workspace', icon: BriefcaseBusiness },
  { label: 'AI Chat', path: '/ai-chat', icon: Bot },
  { label: 'Code Review', path: '/code-review', icon: Code2 },
  { label: 'Bugs & Security', path: '/security', icon: ShieldAlert },
  { label: 'Documentation', path: '/documentation', icon: BookOpen },
  { label: 'Tasks', path: '/tasks', icon: ListTodo },
  { label: 'Sprints', path: '/sprints', icon: Sparkles },
  { label: 'Team', path: '/team', icon: Users },
  { label: 'Reports', path: '/reports', icon: BarChart3 },
  { label: 'Settings', path: '/settings', icon: Settings },
]
