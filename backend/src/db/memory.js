const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const config = require('../config')

const usersByEmail = new Map()
const emailVerifications = new Map()
const refreshTokens = new Map()
const consumedRefreshTokens = new Map()
const passwordResets = new Map()
const passwordHistory = new Map()

const projects = [
  {
    id: 'e-commerce-platform',
    name: 'E-Commerce Platform',
    description: 'Full-stack commerce application with authentication, products, orders, and payments.',
    stack: ['React', 'Node.js', 'PostgreSQL'],
    status: 'Active',
    owner: 'Sai Patel',
    ownerEmail: 'sai@example.com',
    teamSize: 4,
    updated: '30 minutes ago',
    updatedAt: new Date(Date.now() - 30 * 60000).toISOString(),
    created: 'May 12, 2026',
    createdAt: new Date('2026-05-12').toISOString(),
    progress: 72,
  },
  {
    id: 'task-management-system',
    name: 'Task Management System',
    description: 'Collaborative planning workspace for teams managing projects and delivery.',
    stack: ['React', 'Express', 'PostgreSQL'],
    status: 'Active',
    owner: 'Sai Patel',
    ownerEmail: 'sai@example.com',
    teamSize: 5,
    updated: '2 hours ago',
    updatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    created: 'April 28, 2026',
    createdAt: new Date('2026-04-28').toISOString(),
    progress: 58,
  },
  {
    id: 'portfolio-analyzer',
    name: 'Portfolio Analyzer',
    description: 'Python-based portfolio analysis tool with FastAPI backend and AI-powered insights.',
    stack: ['Python', 'FastAPI', 'React'],
    status: 'Analysis Complete',
    owner: 'Priya Nair',
    ownerEmail: 'priya@example.com',
    teamSize: 3,
    updated: '1 day ago',
    updatedAt: new Date(Date.now() - 24 * 3600000).toISOString(),
    created: 'June 3, 2026',
    createdAt: new Date('2026-06-03').toISOString(),
    progress: 100,
  },
  {
    id: 'secure-file-manager',
    name: 'Secure File Manager',
    description: 'End-to-end encrypted file storage and sharing platform.',
    stack: ['TypeScript', 'Node.js', 'Redis'],
    status: 'Active',
    owner: 'Sai Patel',
    ownerEmail: 'sai@example.com',
    teamSize: 2,
    updated: '3 hours ago',
    updatedAt: new Date(Date.now() - 3 * 3600000).toISOString(),
    created: 'July 15, 2026',
    createdAt: new Date('2026-07-15').toISOString(),
    progress: 35,
  },
  {
    id: 'api-gateway-service',
    name: 'API Gateway Service',
    description: 'Microservices API gateway with rate limiting, auth, and request routing.',
    stack: ['Go', 'Docker', 'Kubernetes'],
    status: 'Active',
    owner: 'Priya Nair',
    ownerEmail: 'priya@example.com',
    teamSize: 4,
    updated: '5 hours ago',
    updatedAt: new Date(Date.now() - 5 * 3600000).toISOString(),
    created: 'August 1, 2026',
    createdAt: new Date('2026-08-01').toISOString(),
    progress: 44,
  },
  {
    id: 'ml-pipeline-runner',
    name: 'ML Pipeline Runner',
    description: 'Machine learning pipeline orchestration and experiment tracking platform.',
    stack: ['Python', 'TensorFlow', 'Airflow'],
    status: 'Archived',
    owner: 'Sai Patel',
    ownerEmail: 'sai@example.com',
    teamSize: 3,
    updated: '2 weeks ago',
    updatedAt: new Date(Date.now() - 14 * 24 * 3600000).toISOString(),
    created: 'March 10, 2026',
    createdAt: new Date('2026-03-10').toISOString(),
    progress: 100,
  },
]

const tasks = [
  {
    id: 'task-1',
    title: 'Implement JWT refresh token rotation',
    description: 'Add rotating refresh tokens with reuse detection to the auth middleware.',
    status: 'Done',
    priority: 'High',
    assignee: 'Sai Patel',
    assigneeEmail: 'sai@example.com',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString(),
  },
  {
    id: 'task-2',
    title: 'Add product search with filters',
    description: 'Implement full-text search with category, price range, and rating filters.',
    status: 'In Progress',
    priority: 'High',
    assignee: 'Priya Nair',
    assigneeEmail: 'priya@example.com',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    createdAt: new Date(Date.now() - 3 * 24 * 3600000).toISOString(),
  },
  {
    id: 'task-3',
    title: 'Design checkout flow UI',
    description: 'Create responsive checkout flow with address, shipping, and payment steps.',
    status: 'In Progress',
    priority: 'Medium',
    assignee: 'Sai Patel',
    assigneeEmail: 'sai@example.com',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    createdAt: new Date(Date.now() - 2 * 24 * 3600000).toISOString(),
  },
  {
    id: 'task-4',
    title: 'Set up CI/CD pipeline',
    description: 'Configure GitHub Actions for automated testing and deployment.',
    status: 'Todo',
    priority: 'Medium',
    assignee: 'Priya Nair',
    assigneeEmail: 'priya@example.com',
    project: 'Task Management System',
    projectId: 'task-management-system',
    createdAt: new Date(Date.now() - 1 * 24 * 3600000).toISOString(),
  },
  {
    id: 'task-5',
    title: 'Add drag-and-drop task boards',
    description: 'Implement Kanban-style drag and drop for task management.',
    status: 'In Progress',
    priority: 'High',
    assignee: 'Sai Patel',
    assigneeEmail: 'sai@example.com',
    project: 'Task Management System',
    projectId: 'task-management-system',
    createdAt: new Date(Date.now() - 4 * 24 * 3600000).toISOString(),
  },
  {
    id: 'task-6',
    title: 'Write API integration tests',
    description: 'Add comprehensive integration tests for all REST endpoints.',
    status: 'Todo',
    priority: 'Low',
    assignee: 'Priya Nair',
    assigneeEmail: 'priya@example.com',
    project: 'Task Management System',
    projectId: 'task-management-system',
    createdAt: new Date(Date.now() - 6 * 24 * 3600000).toISOString(),
  },
  {
    id: 'task-7',
    title: 'Optimize database queries',
    description: 'Profile and optimize slow queries in the reporting module.',
    status: 'Todo',
    priority: 'Medium',
    assignee: 'Sai Patel',
    assigneeEmail: 'sai@example.com',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    createdAt: new Date(Date.now() - 7 * 24 * 3600000).toISOString(),
  },
]

const sprints = [
  {
    id: 'sprint-1',
    name: 'Sprint 14 — Auth & Access',
    goal: 'Ship JWT auth, protected routes, and invite flow for the workspace.',
    startDate: '2026-09-01',
    endDate: '2026-09-14',
    status: 'Completed',
    progress: 100,
    createdBy: 'sai@example.com',
    createdAt: new Date('2026-09-01').toISOString(),
  },
  {
    id: 'sprint-2',
    name: 'Sprint 15 — Delivery Boards',
    goal: 'Launch tasks and sprint planning surfaces.',
    startDate: '2026-09-15',
    endDate: '2026-09-28',
    status: 'Active',
    progress: 62,
    createdBy: 'sai@example.com',
    createdAt: new Date('2026-09-15').toISOString(),
  },
  {
    id: 'sprint-3',
    name: 'Sprint 16 — Search & Discovery',
    goal: 'Implement full-text search, filtering, and sorting across projects.',
    startDate: '2026-09-29',
    endDate: '2026-10-12',
    status: 'Planning',
    progress: 0,
    createdBy: 'priya@example.com',
    createdAt: new Date('2026-09-29').toISOString(),
  },
  {
    id: 'sprint-4',
    name: 'Sprint 17 — Performance',
    goal: 'Optimize bundle size, database queries, and API response times.',
    startDate: '2026-10-13',
    endDate: '2026-10-26',
    status: 'Planning',
    progress: 0,
    createdBy: 'sai@example.com',
    createdAt: new Date('2026-10-13').toISOString(),
  },
]

const members = [
  { id: 'member-1', name: 'Sai Patel', role: 'Lead', email: 'sai@example.com', projects: 6, status: 'Active' },
  { id: 'member-2', name: 'Priya Nair', role: 'Engineer', email: 'priya@example.com', projects: 4, status: 'Active' },
  { id: 'member-3', name: 'Alex Kumar', role: 'Engineer', email: 'alex@example.com', projects: 3, status: 'Active' },
  { id: 'member-4', name: 'Jordan Lee', role: 'Designer', email: 'jordan@example.com', projects: 2, status: 'Active' },
  { id: 'member-5', name: 'Morgan Chen', role: 'QA', email: 'morgan@example.com', projects: 5, status: 'Away' },
  { id: 'member-6', name: 'Taylor Singh', role: 'Product', email: 'taylor@example.com', projects: 4, status: 'Active' },
]

const reviews = [
  {
    id: 'review-1',
    title: 'Auth module refactor',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    status: 'Completed',
    findingsCount: 3,
    findings: [],
    createdAt: new Date(Date.now() - 2 * 24 * 3600000).toISOString(),
  },
  {
    id: 'review-2',
    title: 'Checkout flow review',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    status: 'In Progress',
    findingsCount: 1,
    findings: [],
    createdAt: new Date(Date.now() - 1 * 24 * 3600000).toISOString(),
  },
  {
    id: 'review-3',
    title: 'API gateway design review',
    project: 'API Gateway Service',
    projectId: 'api-gateway-service',
    status: 'Completed',
    findingsCount: 5,
    findings: [],
    createdAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString(),
  },
]

const documents = [
  {
    id: 'doc-1',
    title: 'E-Commerce Platform — README',
    type: 'README',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    status: 'Ready',
    createdAt: new Date(Date.now() - 10 * 24 * 3600000).toISOString(),
  },
  {
    id: 'doc-2',
    title: 'API Gateway — Architecture',
    type: 'Architecture',
    project: 'API Gateway Service',
    projectId: 'api-gateway-service',
    status: 'Ready',
    createdAt: new Date(Date.now() - 7 * 24 * 3600000).toISOString(),
  },
  {
    id: 'doc-3',
    title: 'Task System — Installation Guide',
    type: 'Installation',
    project: 'Task Management System',
    projectId: 'task-management-system',
    status: 'Ready',
    createdAt: new Date(Date.now() - 3 * 24 * 3600000).toISOString(),
  },
]

const conversations = []
const reports = []

const activity = [
  {
    id: 'act-1',
    type: 'ai',
    message: 'AI project analysis completed for E-Commerce Platform',
    actorEmail: 'sai@example.com',
    projectId: 'e-commerce-platform',
    createdAt: new Date(Date.now() - 2 * 60000).toISOString(),
  },
  {
    id: 'act-2',
    type: 'project',
    message: 'Sai Patel updated E-Commerce Platform',
    actorEmail: 'sai@example.com',
    projectId: 'e-commerce-platform',
    createdAt: new Date(Date.now() - 30 * 60000).toISOString(),
  },
  {
    id: 'act-3',
    type: 'review',
    message: 'Code review completed for Auth module refactor',
    actorEmail: 'priya@example.com',
    projectId: 'e-commerce-platform',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'act-4',
    type: 'task',
    message: 'Task moved to In Progress: Add product search with filters',
    actorEmail: 'priya@example.com',
    projectId: 'e-commerce-platform',
    createdAt: new Date(Date.now() - 2 * 3600000).toISOString(),
  },
  {
    id: 'act-5',
    type: 'docs',
    message: 'Documentation generated: API Gateway — Architecture',
    actorEmail: 'sai@example.com',
    projectId: 'api-gateway-service',
    createdAt: new Date(Date.now() - 5 * 3600000).toISOString(),
  },
  {
    id: 'act-6',
    type: 'security',
    message: 'Security scan completed: 2 new findings in E-Commerce Platform',
    actorEmail: 'morgan@example.com',
    projectId: 'e-commerce-platform',
    createdAt: new Date(Date.now() - 8 * 3600000).toISOString(),
  },
  {
    id: 'act-7',
    type: 'team',
    message: 'Alex Kumar joined the workspace',
    actorEmail: 'sai@example.com',
    createdAt: new Date(Date.now() - 24 * 3600000).toISOString(),
  },
]

const MAX_PASSWORD_HISTORY = 5

function addPasswordToHistory(userId, passwordHash) {
  if (!passwordHistory.has(userId)) {
    passwordHistory.set(userId, [])
  }
  const history = passwordHistory.get(userId)
  history.unshift({ hash: passwordHash, createdAt: new Date().toISOString() })
  if (history.length > MAX_PASSWORD_HISTORY) {
    history.length = MAX_PASSWORD_HISTORY
  }
}

function isPasswordReused(userId, password) {
  const history = passwordHistory.get(userId)
  if (!history || history.length === 0) return false
  for (const entry of history) {
    if (bcrypt.compareSync(password, entry.hash)) {
      return true
    }
  }
  return false
}

async function seedDemoUser() {
  if (usersByEmail.has(config.demoEmail)) return
  const passwordHash = await bcrypt.hash(config.demoPassword, 10)
  const userId = crypto.randomUUID()
  usersByEmail.set(config.demoEmail.toLowerCase(), {
    id: userId,
    fullName: 'Demo User',
    email: config.demoEmail,
    role: 'Developer',
    passwordHash,
    tokenVersion: 0,
    createdAt: new Date().toISOString(),
  })
  addPasswordToHistory(userId, passwordHash)
}

module.exports = {
  usersByEmail,
  emailVerifications,
  refreshTokens,
  consumedRefreshTokens,
  passwordResets,
  passwordHistory,
  addPasswordToHistory,
  isPasswordReused,
  projects,
  tasks,
  sprints,
  members,
  reviews,
  documents,
  conversations,
  reports,
  activity,
  seedDemoUser,
  MAX_PASSWORD_HISTORY,
}
