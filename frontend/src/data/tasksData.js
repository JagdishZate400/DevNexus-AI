export const taskStatuses = ['Todo', 'In Progress', 'Done']
export const taskPriorities = ['Low', 'Medium', 'High']

export const taskAssignees = ['Sai', 'Priya', 'Alex', 'Jordan', 'Maya']

export const taskProjects = [
  'E-Commerce Platform',
  'Task Management System',
  'Portfolio Analyzer',
  'Secure File Manager',
  'API Documentation Assistant',
]

export const initialTasks = [
  {
    id: 'task-1',
    title: 'Implement JWT authentication middleware',
    description: 'Add token verification and role checks for protected API routes.',
    status: 'In Progress',
    priority: 'High',
    assignee: 'Sai',
    project: 'E-Commerce Platform',
    createdAt: '2026-09-10',
  },
  {
    id: 'task-2',
    title: 'Design sprint board layout',
    description: 'Wire up columns and drag affordances for the sprint planning view.',
    status: 'Todo',
    priority: 'Medium',
    assignee: 'Priya',
    project: 'Task Management System',
    createdAt: '2026-09-12',
  },
  {
    id: 'task-3',
    title: 'Fix XSS sanitization in chat input',
    description: 'Escape user-generated content before rendering in message bubbles.',
    status: 'In Progress',
    priority: 'High',
    assignee: 'Alex',
    project: 'Secure File Manager',
    createdAt: '2026-09-08',
  },
  {
    id: 'task-4',
    title: 'Generate OpenAPI docs for review endpoints',
    description: 'Document request/response schemas for code review API routes.',
    status: 'Done',
    priority: 'Low',
    assignee: 'Maya',
    project: 'API Documentation Assistant',
    createdAt: '2026-09-05',
  },
  {
    id: 'task-5',
    title: 'Add portfolio scoring heuristics',
    description: 'Score project completeness, stack depth, and documentation coverage.',
    status: 'Todo',
    priority: 'Medium',
    assignee: 'Jordan',
    project: 'Portfolio Analyzer',
    createdAt: '2026-09-14',
  },
  {
    id: 'task-6',
    title: 'Write unit tests for project filters',
    description: 'Cover search, status, and technology filter combinations.',
    status: 'Done',
    priority: 'Medium',
    assignee: 'Priya',
    project: 'Task Management System',
    createdAt: '2026-09-03',
  },
  {
    id: 'task-7',
    title: 'Audit dependency vulnerabilities',
    description: 'Run npm audit and triage high-severity advisories.',
    status: 'Todo',
    priority: 'High',
    assignee: 'Alex',
    project: 'E-Commerce Platform',
    createdAt: '2026-09-15',
  },
]
