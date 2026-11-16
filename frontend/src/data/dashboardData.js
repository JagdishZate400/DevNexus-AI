import { BarChart3, BriefcaseBusiness, CheckSquare, FolderKanban } from 'lucide-react'

export const aiOverview = [
  { label: 'Code Reviews', value: '9' },
  { label: 'Documents Generated', value: '4' },
  { label: 'Open Tasks', value: '12' },
  { label: 'Critical Findings', value: '3' },
]

export const reviewSummary = { reviews: '9 reviews completed', suggestions: '4 documents generated', attention: '12 open tasks need attention' }
export const securitySummary = { findings: '11 total findings', high: '3 critical/high', medium: '4 medium · 6 open' }

export const activities = [
  { label: 'AI project analysis completed', time: '2 minutes ago', icon: BarChart3 },
  { label: 'Sai updated E-Commerce Platform', time: '30 minutes ago', icon: FolderKanban },
  { label: 'Code review completed', time: '1 hour ago', icon: CheckSquare },
  { label: 'Task moved to Done', time: '2 hours ago', icon: CheckSquare },
  { label: 'Documentation generated', time: 'Yesterday', icon: BriefcaseBusiness },
]
