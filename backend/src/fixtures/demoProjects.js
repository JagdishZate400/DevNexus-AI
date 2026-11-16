const DEMO_PROJECTS = [
  {
    id: 'e-commerce-platform',
    name: 'E-Commerce Platform',
    description: 'Full-stack commerce application with authentication, products, orders, and payments.',
    stack: ['React', 'Node.js', 'PostgreSQL'],
    status: 'Active',
    owner: 'Demo Owner',
    ownerEmail: 'sai@example.com',
    teamSize: 4,
    updated: '30 minutes ago',
    updatedAt: new Date(Date.now() - 30 * 60000).toISOString(),
    created: 'May 12, 2026',
    createdAt: new Date('2026-05-12').toISOString(),
    progress: 72,
    isDemo: true,
  },
  {
    id: 'task-management-system',
    name: 'Task Management System',
    description: 'Collaborative planning workspace for teams managing projects and delivery.',
    stack: ['React', 'Express', 'PostgreSQL'],
    status: 'Active',
    owner: 'Demo Owner',
    ownerEmail: 'sai@example.com',
    teamSize: 5,
    updated: '2 hours ago',
    updatedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
    created: 'April 28, 2026',
    createdAt: new Date('2026-04-28').toISOString(),
    progress: 58,
    isDemo: true,
  },
  {
    id: 'portfolio-analyzer',
    name: 'Portfolio Analyzer',
    description: 'AI-assisted tool for reviewing technical portfolios and project signals.',
    stack: ['Python', 'FastAPI', 'AI'],
    status: 'Analysis Complete',
    owner: 'Demo Owner',
    ownerEmail: 'sai@example.com',
    teamSize: 3,
    updated: 'Yesterday',
    updatedAt: new Date(Date.now() - 24 * 3600000).toISOString(),
    created: 'April 10, 2026',
    createdAt: new Date('2026-04-10').toISOString(),
    progress: 100,
    isDemo: true,
  },
  {
    id: 'secure-file-manager',
    name: 'Secure File Manager',
    description: 'Developer-focused file management with permissions and audit history.',
    stack: ['React', 'Node.js', 'Security'],
    status: 'Active',
    owner: 'Demo Owner',
    ownerEmail: 'sai@example.com',
    teamSize: 4,
    updated: '3 days ago',
    updatedAt: new Date(Date.now() - 3 * 24 * 3600000).toISOString(),
    created: 'March 22, 2026',
    createdAt: new Date('2026-03-22').toISOString(),
    progress: 44,
    isDemo: true,
  },
  {
    id: 'student-management-portal',
    name: 'Student Management Portal',
    description: 'A central portal for student records, communication, and administration.',
    stack: ['React', 'Node.js', 'PostgreSQL'],
    status: 'Archived',
    owner: 'Demo Owner',
    ownerEmail: 'sai@example.com',
    teamSize: 2,
    updated: 'May 2, 2026',
    updatedAt: new Date(Date.now() - 8 * 24 * 3600000).toISOString(),
    created: 'February 15, 2026',
    createdAt: new Date('2026-02-15').toISOString(),
    progress: 100,
    isDemo: true,
  },
  {
    id: 'api-documentation-assistant',
    name: 'API Documentation Assistant',
    description: 'A focused workspace for generating and maintaining API documentation.',
    stack: ['Python', 'FastAPI', 'AI'],
    status: 'Active',
    owner: 'Demo Owner',
    ownerEmail: 'sai@example.com',
    teamSize: 3,
    updated: '5 days ago',
    updatedAt: new Date(Date.now() - 5 * 24 * 3600000).toISOString(),
    created: 'January 30, 2026',
    createdAt: new Date('2026-01-30').toISOString(),
    progress: 35,
    isDemo: true,
  },
]

const DEMO_PROJECT_IDS = new Set(DEMO_PROJECTS.map((p) => p.id))

function isDemoProjectId(id) {
  return DEMO_PROJECT_IDS.has(id)
}

function getDemoProject(id) {
  return DEMO_PROJECTS.find((p) => p.id === id) || null
}

function filterDemoProjects({ search, status } = {}) {
  let list = [...DEMO_PROJECTS]
  if (status && status !== 'All statuses') {
    list = list.filter((p) => p.status === status)
  }
  if (search && String(search).trim()) {
    const q = String(search).toLowerCase().trim()
    list = list.filter(
      (p) =>
        String(p.name || '').toLowerCase().includes(q) ||
        String(p.description || '').toLowerCase().includes(q) ||
        (p.stack || []).some((s) => String(s).toLowerCase().includes(q))
    )
  }
  return list
}

module.exports = {
  DEMO_PROJECTS,
  DEMO_PROJECT_IDS,
  isDemoProjectId,
  getDemoProject,
  filterDemoProjects,
}
