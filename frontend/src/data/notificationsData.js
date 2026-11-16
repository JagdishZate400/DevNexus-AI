import { BarChart3, BriefcaseBusiness, CheckSquare, FolderKanban, ShieldAlert } from 'lucide-react'

// Workspace notifications shown in the header bell dropdown.
// Sourced from real workspace activity (dashboard, reviews, security).
export const initialNotifications = [
  { id: 'ai-analysis-done', title: 'AI project analysis completed', detail: 'E-Commerce Platform · 2 minutes ago', icon: BarChart3 },
  { id: 'project-updated', title: 'Sai updated E-Commerce Platform', detail: '30 minutes ago', icon: FolderKanban },
  { id: 'review-completed', title: 'Code review completed', detail: '9 reviews · 4 suggestions · 1 hour ago', icon: CheckSquare },
  { id: 'security-findings', title: '3 potential security findings', detail: '1 high · 2 medium · review recommended', icon: ShieldAlert },
  { id: 'task-done', title: 'Task moved to Done', detail: '2 hours ago', icon: CheckSquare },
  { id: 'docs-generated', title: 'Documentation generated', detail: 'Yesterday', icon: BriefcaseBusiness },
]
