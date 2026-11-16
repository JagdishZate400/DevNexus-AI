export const reportSummary = [
  { label: 'Reviews run', value: 24, detail: '9 this month', key: 'reviews' },
  { label: 'Security findings', value: 11, detail: '3 high severity', key: 'security' },
  { label: 'Docs generated', value: 18, detail: '5 exported', key: 'docs' },
  { label: 'Chat sessions', value: 47, detail: '12 this week', key: 'chat' },
]

export const initialReports = [
  {
    id: 'report-1',
    title: 'Weekly engineering digest',
    type: 'Summary',
    project: 'All projects',
    date: 'Sep 15, 2026',
    status: 'Ready',
  },
  {
    id: 'report-2',
    title: 'Security triage — E-Commerce',
    type: 'Security',
    project: 'E-Commerce Platform',
    date: 'Sep 14, 2026',
    status: 'Ready',
  },
  {
    id: 'report-3',
    title: 'Code review quality trends',
    type: 'Review',
    project: 'Task Management System',
    date: 'Sep 12, 2026',
    status: 'Ready',
  },
  {
    id: 'report-4',
    title: 'Documentation coverage snapshot',
    type: 'Documentation',
    project: 'API Documentation Assistant',
    date: 'Sep 10, 2026',
    status: 'Archived',
  },
  {
    id: 'report-5',
    title: 'Sprint 14 delivery report',
    type: 'Sprint',
    project: 'All projects',
    date: 'Sep 8, 2026',
    status: 'Ready',
  },
]
