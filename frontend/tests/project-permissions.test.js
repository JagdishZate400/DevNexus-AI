import test from 'node:test'
import assert from 'node:assert/strict'

// Set up mock localStorage for Node test runner environment
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
}

import {
  canManageProject,
  canDeleteProject,
  isManagerRole,
  isProjectOwner,
} from '../src/utils/projectPermissions.js'
import { useAuthStore, clearProjectCache } from '../src/store/authStore.js'
import { useProjectsStore } from '../src/store/projectsStore.js'
import { projectsApi } from '../src/services/api.js'

test('Scenario 1: Project Owner can manage project', () => {
  const ownerUser = {
    id: 'user-101',
    email: 'fixture3@example.com',
    name: 'Synthetic Owner',
    role: 'Developer',
  }

  // Owned by exact email
  assert.equal(
    canManageProject(ownerUser, { id: 'p1', ownerEmail: 'fixture3@example.com', owner: 'Synthetic Owner' }),
    true
  )

  // Owned by ownerId
  assert.equal(
    canManageProject(ownerUser, { id: 'p2', ownerId: 'user-101', owner: 'Someone' }),
    true
  )

  // Owned by email prefix match
  assert.equal(
    canManageProject(ownerUser, { id: 'p3', owner: 'fixture3' }),
    true
  )

  // Direct isProjectOwner check
  assert.equal(isProjectOwner(ownerUser, { ownerEmail: 'FIXTURE3@EXAMPLE.COM' }), true)
  assert.equal(canDeleteProject(ownerUser, { id: 'p1', ownerEmail: 'fixture3@example.com', owner: 'Synthetic Owner' }), true)
  assert.equal(canDeleteProject(ownerUser, { id: 'e-commerce-platform', isDemo: true, ownerEmail: 'fixture3@example.com' }), false)
})

test('Scenario 2: Developer non-owner cannot manage project', () => {
  const developerUser = {
    id: 'dev-202',
    email: 'fixture2@example.com',
    name: 'Synthetic Developer',
    role: 'Developer',
  }

  const otherProject = {
    id: 'p-other',
    name: 'Protected Service',
    owner: 'Synthetic Owner',
    ownerEmail: 'fixture3@example.com',
    ownerId: 'user-101',
  }

  assert.equal(canManageProject(developerUser, otherProject), false)
  assert.equal(isProjectOwner(developerUser, otherProject), false)
  assert.equal(canDeleteProject(developerUser, otherProject), false)

  // Missing arguments fail closed
  assert.equal(canManageProject(null, otherProject), false)
  assert.equal(canManageProject(developerUser, null), false)
  assert.equal(canManageProject(undefined, undefined), false)
  assert.equal(canDeleteProject(null, otherProject), false)
  assert.equal(canDeleteProject(developerUser, null), false)
})

test('Scenario 3: Team Lead and Project Manager have management privileges across projects', () => {
  const teamLead = {
    id: 'lead-301',
    email: 'fixture1@example.com',
    name: 'Synthetic Lead',
    role: 'Team Lead',
  }

  const projectManager = {
    id: 'pm-401',
    email: 'pm@example.com',
    name: 'PM Alice',
    role: 'Project Manager',
  }

  const developerProject = {
    id: 'p-dev',
    name: 'Dev Project',
    owner: 'Synthetic Owner',
    ownerEmail: 'fixture3@example.com',
    ownerId: 'user-101',
  }

  assert.equal(isManagerRole(teamLead.role), true)
  assert.equal(isManagerRole(projectManager.role), true)
  assert.equal(isManagerRole('Developer'), false)
  assert.equal(isManagerRole('Architect'), false)

  // Both manager roles can manage projects they do not own, but CANNOT delete them
  assert.equal(canManageProject(teamLead, developerProject), true)
  assert.equal(canManageProject(projectManager, developerProject), true)
  assert.equal(canDeleteProject(teamLead, developerProject), false)
  assert.equal(canDeleteProject(projectManager, developerProject), false)
})

test('Scenario 4: resetProjects clears projects and purges localStorage', () => {
  localStorage.setItem('ai-assistant-projects', JSON.stringify({ state: { projects: [{ id: 'old-1' }] } }))
  useProjectsStore.setState({ projects: [{ id: 'old-1', name: 'Old' }] })

  assert.equal(useProjectsStore.getState().projects.length, 1)
  assert.ok(localStorage.getItem('ai-assistant-projects'))

  useProjectsStore.getState().resetProjects([])

  assert.equal(useProjectsStore.getState().projects.length, 0)
  assert.equal(localStorage.getItem('ai-assistant-projects'), null)
})

test('Scenario 5: Account switching and session clear trigger cache invalidation', () => {
  localStorage.setItem('ai-assistant-projects', JSON.stringify({ state: { projects: [{ id: 'cached-proj' }] } }))
  useProjectsStore.setState({ projects: [{ id: 'cached-proj', name: 'Cached' }] })

  // Calling clearProjectCache directly
  clearProjectCache()
  assert.equal(useProjectsStore.getState().projects.length, 0)
  assert.equal(localStorage.getItem('ai-assistant-projects'), null)

  // Calling clearSession on authStore
  useProjectsStore.setState({ projects: [{ id: 'cached-proj-2', name: 'Cached 2' }] })
  localStorage.setItem('ai-assistant-projects', JSON.stringify({ state: { projects: [{ id: 'cached-proj-2' }] } }))
  useAuthStore.getState().clearSession()

  assert.equal(useProjectsStore.getState().projects.length, 0)
  assert.equal(localStorage.getItem('ai-assistant-projects'), null)

  // Calling logout on authStore
  useProjectsStore.setState({ projects: [{ id: 'cached-proj-3', name: 'Cached 3' }] })
  localStorage.setItem('ai-assistant-projects', JSON.stringify({ state: { projects: [{ id: 'cached-proj-3' }] } }))
  useAuthStore.getState().logout()

  assert.equal(useProjectsStore.getState().projects.length, 0)
  assert.equal(localStorage.getItem('ai-assistant-projects'), null)
})

test('Scenario 6: fetchProject on 404 purges stale cached project and throws 404 error', async () => {
  const staleId = 'stale-acceptance-proj-2c176b57'
  useProjectsStore.setState({
    projects: [
      { id: staleId, name: 'Stale Ghost Project' },
      { id: 'valid-p1', name: 'Valid Project' },
    ],
  })

  // Set real-like token in authStore so fetchProject performs remote check
  useAuthStore.setState({ token: 'test-jwt-token' })

  // Mock projectsApi.get to return 404
  const originalGet = projectsApi.get
  projectsApi.get = async (_token, id) => {
    if (id === staleId) {
      const err = new Error('Project not found')
      err.status = 404
      throw err
    }
    return { project: { id, name: 'Remote Project' } }
  }

  try {
    await assert.rejects(
      async () => {
        await useProjectsStore.getState().fetchProject(staleId)
      },
      (err) => err.status === 404
    )

    // Verify stale project was purged from local state
    const remaining = useProjectsStore.getState().projects
    assert.equal(remaining.some((p) => p.id === staleId), false)
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].id, 'valid-p1')
  } finally {
    projectsApi.get = originalGet
    useAuthStore.setState({ token: null })
  }
})

test('Scenario 7: Failed PATCH in updateProject rolls back to previous state', async () => {
  const projId = 'rollback-test-p1'
  const originalDescription = 'Legitimate owner description'
  useProjectsStore.setState({
    projects: [
      { id: projId, name: 'Rollback Project', description: originalDescription },
    ],
  })

  useAuthStore.setState({ token: 'test-jwt-token' })

  // Mock projectsApi.update to fail with 403 Forbidden
  const originalUpdate = projectsApi.update
  projectsApi.update = async () => {
    const err = new Error('Only the project owner or a lead can edit this project')
    err.status = 403
    throw err
  }

  try {
    await assert.rejects(
      async () => {
        await useProjectsStore.getState().updateProject(projId, {
          description: 'Unauthorized edit verification',
        })
      },
      (err) => err.status === 403
    )

    // Store must roll back to originalDescription
    const proj = useProjectsStore.getState().projects.find((p) => p.id === projId)
    assert.equal(proj.description, originalDescription)
  } finally {
    projectsApi.update = originalUpdate
    useAuthStore.setState({ token: null })
  }
})

test('Scenario 8: Normal project creation and listing remain functional', async () => {
  useAuthStore.setState({
    user: { id: 'u-current', email: 'creator@example.com', name: 'Creator User', role: 'Developer' },
    token: null, // local mock mode
  })

  const newProjPayload = {
    name: 'Platform Core',
    description: 'High reliability service',
    stack: ['Go', 'PostgreSQL'],
  }

  const result = await useProjectsStore.getState().createProject(newProjPayload)
  const createdProject = result?.project || result
  assert.ok(createdProject.id)
  assert.equal(createdProject.name, 'Platform Core')
  assert.equal(createdProject.ownerEmail, 'creator@example.com')

  const inStore = useProjectsStore.getState().projects.find((p) => p.id === createdProject.id)
  assert.ok(inStore)
  assert.equal(inStore.name, 'Platform Core')
})

test('Scenario 9: Preserve Six Demo Projects: loadProjects merges persistent projects and 6 demo fixtures', async () => {
  useAuthStore.setState({ token: 'test-jwt-token' })

  const originalList = projectsApi.list
  const originalGet = projectsApi.get

  projectsApi.list = async () => ({
    projects: [
      { id: 'sentinelwaf-ai', name: 'SentinelWAF AI', status: 'Active', progress: 100, stack: ['Python', 'FastAPI'] },
      { id: 'user-custom-project', name: 'My Custom App', status: 'Active', progress: 20, stack: ['React'] },
    ],
    demoProjects: [
      { id: 'e-commerce-platform', name: 'E-Commerce Platform', status: 'Active', isDemo: true },
      { id: 'task-management-system', name: 'Task Management System', status: 'Active', isDemo: true },
      { id: 'portfolio-analyzer', name: 'Portfolio Analyzer', status: 'Analysis Complete', isDemo: true },
      { id: 'secure-file-manager', name: 'Secure File Manager', status: 'Active', isDemo: true },
      { id: 'student-management-portal', name: 'Student Management Portal', status: 'Archived', isDemo: true },
      { id: 'api-documentation-assistant', name: 'API Documentation Assistant', status: 'Active', isDemo: true },
    ],
  })

  try {
    const loaded = await useProjectsStore.getState().loadProjects()
    assert.equal(loaded.length, 8) // 2 persistent + 6 demos

    const myProjects = loaded.filter((p) => !p.isDemo)
    const demoProjects = loaded.filter((p) => p.isDemo)

    assert.equal(myProjects.length, 2)
    assert.equal(demoProjects.length, 6)

    const expectedDemoIds = [
      'e-commerce-platform',
      'task-management-system',
      'portfolio-analyzer',
      'secure-file-manager',
      'student-management-portal',
      'api-documentation-assistant',
    ]

    for (const demoId of expectedDemoIds) {
      assert.ok(demoProjects.some((d) => d.id === demoId))
    }

    // Demo projects cannot be updated or deleted in store
    await assert.rejects(
      async () => {
        await useProjectsStore.getState().updateProject('e-commerce-platform', { name: 'Changed' })
      },
      (err) => err.status === 403
    )

    await assert.rejects(
      async () => {
        await useProjectsStore.getState().removeProject('e-commerce-platform')
      },
      (err) => err.status === 403
    )
  } finally {
    projectsApi.list = originalList
    projectsApi.get = originalGet
    useAuthStore.setState({ token: null })
  }
})
