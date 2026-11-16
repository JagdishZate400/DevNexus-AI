require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { Pool } = require('pg')

const { createMembershipRepository } = require('../src/db/membershipRepository')
const { createTaskRepository } = require('../src/db/taskRepository')
const { createSprintRepository } = require('../src/db/sprintRepository')
const { createReportsRepository } = require('../src/db/reportsRepository')

// Isolated real PostgreSQL acceptance suite for Team Management (F1B) and Reports (F2B).
// Gated strictly on F3_ACCEPTANCE_TEST_DATABASE_URL; never falls back to DATABASE_URL.
const testDbUrl = process.env.F3_ACCEPTANCE_TEST_DATABASE_URL

test('DevNexus AI - F3 Real PostgreSQL Acceptance Suite for Team and Reports', { skip: !testDbUrl }, async t => {
  // --- 0. STRICT SECURITY AND CONNECTION ENVELOPE CHECKS ---
  const url = new URL(testDbUrl)
  assert.equal(url.hostname, '127.0.0.1', 'Target host must be 127.0.0.1')
  assert.equal(url.port, '55452', 'Target port must be isolated ephemeral port 55452')
  assert.equal(url.pathname, '/devnexus_test', 'Target database must be /devnexus_test')
  assert.ok(!testDbUrl.includes('devnexus_ai'), 'Safety violation: URL must never reference devnexus_ai')

  const pool = new Pool({ connectionString: testDbUrl, connectionTimeoutMillis: 5000 })

  try {
    const ident = (await pool.query('SELECT current_database() AS db, current_user AS usr, inet_server_port() AS port')).rows[0]
    assert.equal(ident.db, 'devnexus_test', 'Connected database is not devnexus_test')
    assert.equal(ident.usr, 'devnexus_test_runner', 'Connected user is not devnexus_test_runner')
    assert.equal(ident.port, 55452, 'Connected server port is not 55452')

    // Seed baseline identities: Owner, Member, Outsider with unique emails/projects per run
    const suffix = crypto.randomBytes(4).toString('hex')
    const ownerId = crypto.randomUUID()
    const memberId = crypto.randomUUID()
    const outsiderId = crypto.randomUUID()

    const ownerEmail = `owner_${suffix}@f3acceptance.test`
    const memberEmail = `member_${suffix}@f3acceptance.test`
    const outsiderEmail = `outsider_${suffix}@f3acceptance.test`

    await pool.query(`
      INSERT INTO users (id, full_name, email, role, password_hash, token_version) VALUES
      ($1, 'Project Owner', $2, 'Developer', 'hash', 0),
      ($3, 'Team Member', $4, 'Developer', 'hash', 0),
      ($5, 'Outsider User', $6, 'Developer', 'hash', 0)
    `, [ownerId, ownerEmail, memberId, memberEmail, outsiderId, outsiderEmail])

    const projectId = `proj-alpha-${suffix}`
    const foreignProjectId = `proj-beta-${suffix}`

    await pool.query(`
      INSERT INTO source_projects (id, owner_id, name) VALUES
      ($1, $2, 'Alpha Capstone'),
      ($3, $4, 'Beta Foreign')
    `, [projectId, ownerId, foreignProjectId, outsiderId])

    const memberships = createMembershipRepository(pool)
    const tasks = createTaskRepository(pool)
    const sprints = createSprintRepository(pool)
    const reports = createReportsRepository(pool)

    // =========================================================================
    // 1. Owner adding and removing team members
    // =========================================================================
    let memberRecord
    await t.test('1. Owner adds and removes a team member', async () => {
      // Add member
      memberRecord = await memberships.create({
        projectId,
        email: memberEmail,
        displayRole: 'Tester'
      }, ownerId)

      assert.ok(memberRecord.id)
      assert.equal(memberRecord.projectId, projectId)
      assert.equal(memberRecord.userId, memberId)
      assert.equal(memberRecord.displayRole, 'Tester')
      assert.equal(memberRecord.displayName, 'Team Member')

      // Verify persistent row in PostgreSQL
      const persisted = (await pool.query('SELECT * FROM project_memberships WHERE id=$1', [memberRecord.id])).rows[0]
      assert.ok(persisted)
      assert.equal(persisted.user_id, memberId)

      // Re-adding duplicate member must fail with 409 / member_not_added
      await assert.rejects(
        memberships.create({ projectId, email: memberEmail, displayRole: 'Developer' }, ownerId),
        err => err.code === 'member_not_added' && err.status === 409
      )

      // Adding unknown email must fail with 409 / member_not_added
      await assert.rejects(
        memberships.create({ projectId, email: 'nonexistent@test.com', displayRole: 'Developer' }, ownerId),
        err => err.code === 'member_not_added' && err.status === 409
      )
    })

    // =========================================================================
    // 2. Member project and task visibility
    // =========================================================================
    await t.test('2. Member discovers shared projects and views tasks', async () => {
      // Member discovers projects: Alpha has 'member' access, Beta is NOT visible
      const memberProjects = await memberships.projects(memberId)
      assert.equal(memberProjects.projects.length, 1)
      assert.equal(memberProjects.projects[0].id, projectId)
      assert.equal(memberProjects.projects[0].access, 'member')

      // Owner discovers projects: Alpha has 'owner' access
      const ownerProjects = await memberships.projects(ownerId)
      assert.equal(ownerProjects.projects.length, 1)
      assert.equal(ownerProjects.projects[0].id, projectId)
      assert.equal(ownerProjects.projects[0].access, 'owner')

      // Member queries visible directory (limit/offset as strings per query contract)
      const directory = await memberships.directory(memberId, { projectId, limit: '10', offset: '0' })
      assert.equal(directory.owner.userId, ownerId)
      assert.equal(directory.total, 1)
      assert.equal(directory.members[0].userId, memberId)
    })

    // =========================================================================
    // 3. Owner-only authorization enforcement
    // =========================================================================
    await t.test('3. Owner-only authorization is enforced', async () => {
      // Member cannot create tasks
      await assert.rejects(
        tasks.create({ projectId, title: 'Unauthorized task' }, memberId),
        err => err.code === 'not_found' && err.status === 404
      )

      // Member cannot remove other members or self via owner removal endpoint
      await assert.rejects(
        memberships.remove(memberRecord.id, memberId),
        err => err.code === 'not_found' && err.status === 404
      )

      // Member cannot create new memberships
      await assert.rejects(
        memberships.create({ projectId, email: outsiderEmail, displayRole: 'Developer' }, memberId),
        err => err.code === 'not_found' && err.status === 404
      )
    })

    // =========================================================================
    // 4. Task assignment, persistence, and auto-cleanup on member removal
    // =========================================================================
    await t.test('4. Task assignment persists and is cleared when membership is removed', async () => {
      // Owner creates task assigned to Member
      const assignedTask = await tasks.create({
        projectId,
        title: 'Assigned Task 1',
        description: 'Assigned to active member',
        status: 'To Do',
        priority: 'High',
        assigneeUserId: memberId
      }, ownerId)

      assert.equal(assignedTask.assigneeUserId, memberId)
      assert.equal(assignedTask.assignee.userId, memberId)
      assert.equal(assignedTask.assignee.displayName, 'Team Member')

      // Member can see this task via visible tasks endpoint
      const memberVisible = await tasks.visible(memberId, { projectId, limit: '10', offset: '0' })
      assert.equal(memberVisible.total, 1)
      assert.equal(memberVisible.tasks[0].id, assignedTask.id)

      // Now Owner removes the member
      await memberships.remove(memberRecord.id, ownerId)

      // Verify membership record is gone
      const checkMemb = (await pool.query('SELECT * FROM project_memberships WHERE id=$1', [memberRecord.id])).rows
      assert.equal(checkMemb.length, 0)

      // Crucial: Trigger project_memberships_task_assignment_after_delete must have cleared assignee_user_id!
      const afterTask = await tasks.read(assignedTask.id, ownerId)
      assert.equal(afterTask.assigneeUserId, null, 'Assignee must be reset to null upon membership deletion')
      assert.equal(afterTask.assignee, null, 'Assignee object must be null')

      // Former member now denied access to visible tasks
      await assert.rejects(
        tasks.visible(memberId, { projectId, limit: '10', offset: '0' }),
        err => err.code === 'not_found' && err.status === 404
      )
    })

    // =========================================================================
    // 5. Accurate Reports statistics
    // =========================================================================
    let reportSnapshot
    await t.test('5. Reports task and review statistics are accurate', async () => {
      // Populate project with specific task distribution: 1 To Do, 1 In Progress, 1 Done
      // (1 To Do task already exists from previous test)
      await tasks.create({ projectId, title: 'In Progress Task', description: '', status: 'In Progress', priority: 'Medium' }, ownerId)
      await tasks.create({ projectId, title: 'Done Task', description: '', status: 'Done', priority: 'Low' }, ownerId)

      // Add a source file and reviews to test report reviews aggregation
      const fileId = crypto.randomUUID()
      const dummySha = 'a'.repeat(64)
      await pool.query(`
        INSERT INTO source_files (id, project_id, path, language, content, byte_size, sha256)
        VALUES ($1, $2, 'src/index.js', 'JavaScript', 'console.log(1)', 14, $3)
      `, [fileId, projectId, dummySha])

      const reviewId = crypto.randomUUID()
      await pool.query(`
        INSERT INTO repository_reviews (id, project_id, file_id, source_sha256, file_path, provider, model, status, created_by, coverage, options)
        VALUES ($1, $2, $3, $4, 'src/index.js', 'gemini', 'gemini-flash-lite', 'Completed', $5, '{}'::jsonb, '{}'::jsonb)
      `, [reviewId, projectId, fileId, dummySha, ownerId])

      await pool.query(`
        INSERT INTO repository_review_findings (id, review_id, ordinal, severity, category, line, problem, explanation, improvement, code, suggested_code, status, finding_type)
        VALUES
        ('f-1', $1, 1, 'Critical', 'Security', 1, 'Bug 1', 'Exp 1', 'Imp 1', 'c1', 's1', 'Open', 'Security'),
        ('f-2', $1, 2, 'High', 'Performance', 2, 'Bug 2', 'Exp 2', 'Imp 2', 'c2', 's2', 'Open', 'Bug')
      `, [reviewId])

      const batchId = crypto.randomUUID()
      await pool.query(`
        INSERT INTO repository_review_batches (id, project_id, owner_id, options, scope, provider, model, status, idempotency_key)
        VALUES ($1, $2, $3, '{}'::jsonb, 'Selected Files', 'gemini', 'gemini-flash-lite', 'Completed', 'idempotency-key-1')
      `, [batchId, projectId, ownerId])

      // Query real reports repository
      reportSnapshot = await reports.project(ownerId, projectId)

      assert.equal(reportSnapshot.project.id, projectId)
      assert.equal(reportSnapshot.project.name, 'Alpha Capstone')
      assert.ok(reportSnapshot.asOf)

      // Tasks: 1 To Do, 1 In Progress, 1 Done -> total 3, completion: 33.33%
      assert.equal(reportSnapshot.tasks.total, 3)
      assert.equal(reportSnapshot.tasks.toDo, 1)
      assert.equal(reportSnapshot.tasks.inProgress, 1)
      assert.equal(reportSnapshot.tasks.done, 1)
      assert.equal(reportSnapshot.tasks.completionPercent, 33.33)

      // Reviews
      assert.equal(reportSnapshot.reviews.fileReviews.total, 1)
      assert.equal(reportSnapshot.reviews.batches.total, 1)
      assert.equal(reportSnapshot.reviews.findings.total, 2)

      const severities = reportSnapshot.reviews.findings.bySeverity
      assert.equal(severities.find(s => s.severity === 'Critical').count, 1)
      assert.equal(severities.find(s => s.severity === 'High').count, 1)
      assert.equal(severities.find(s => s.severity === 'Medium').count, 0)
    })

    // =========================================================================
    // 6. Sprint completion calculations
    // =========================================================================
    await t.test('6. Sprint completion calculations are correct', async () => {
      // Create Sprint 1 (Active) with 2 tasks assigned: 1 Done, 1 In Progress
      const sprint1 = await sprints.create({
        projectId,
        name: 'Sprint 1 - Launch',
        startDate: '2026-10-01',
        endDate: '2026-10-15',
        goal: 'Complete launch tasks'
      }, ownerId)

      // Create Sprint 2 (Planning) with 0 tasks
      const sprint2 = await sprints.create({
        projectId,
        name: 'Sprint 2 - Follow-up',
        startDate: '2026-10-16',
        endDate: '2026-10-31',
        goal: 'Planning next steps'
      }, ownerId)

      // Assign the Done task and the In Progress task to Sprint 1
      const allTasks = (await tasks.list(ownerId, { projectId, limit: '10', offset: '0' })).tasks
      const doneTask = allTasks.find(t => t.status === 'Done')
      const inProgTask = allTasks.find(t => t.status === 'In Progress')

      await sprints.assign(sprint1.id, doneTask.id, ownerId)
      await sprints.assign(sprint1.id, inProgTask.id, ownerId)

      // Query reports repository
      const rep = await reports.project(ownerId, projectId)
      const s1 = rep.sprints.find(s => s.id === sprint1.id)
      const s2 = rep.sprints.find(s => s.id === sprint2.id)

      // Sprint 1: 2 assigned, 1 done -> 50%
      assert.equal(s1.total, 2)
      assert.equal(s1.done, 1)
      assert.equal(s1.completionPercent, 50)

      // Sprint 2: 0 assigned -> null completion
      assert.equal(s2.total, 0)
      assert.equal(s2.done, 0)
      assert.equal(s2.completionPercent, null)
    })

    // =========================================================================
    // 7. CSV export formatting, quotes, and formula protection
    // =========================================================================
    await t.test('7. CSV export is accurate and safely escaped', async () => {
      // Test the exact CSV building contract matching frontend reportExport.js
      function cell(value) {
        let text = value === null || value === undefined ? 'No tasks' : String(value)
        if (/^[\s\x00-\x1f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text
        return `"${text.replaceAll('"', '""')}"`
      }

      function buildCsv(report) {
        const rows = [
          ['Section', 'Name', 'Status / Category', 'Total / Value', 'Completed', 'Completion (%)'],
          ['Project', report.project.name, 'ID', report.project.id, '', ''],
          ['Report', 'As of', 'UTC', report.asOf, '', ''],
          ['Tasks', 'All tasks', '', report.tasks.total, report.tasks.done, report.tasks.completionPercent],
          ['Sprint', report.sprints[0].name, report.sprints[0].status, report.sprints[0].total, report.sprints[0].done, report.sprints[0].completionPercent],
          ['Sprint', report.sprints[1].name, report.sprints[1].status, report.sprints[1].total, report.sprints[1].done, report.sprints[1].completionPercent]
        ]
        return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
      }

      const rep = await reports.project(ownerId, projectId)
      const csv = buildCsv(rep)

      assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM')
      assert.ok(csv.includes('"33.33"'), 'CSV must contain task completion percentage')
      assert.ok(csv.includes('"50"'), 'CSV must contain sprint completion percentage')
      assert.ok(csv.includes('"No tasks"'), 'CSV must format null completion as "No tasks"')

      // Test formula neutralization
      assert.equal(cell('=SUM(A1:A5)'), `"'=SUM(A1:A5)"`)
      assert.equal(cell('+42'), `"'+42"`)
      assert.equal(cell('-100'), `"'-100"`)
      assert.equal(cell('@calc'), `"'@calc"`)
      assert.equal(cell('Normal Text'), `"Normal Text"`)
      assert.equal(cell('He said "Hello"'), `"He said ""Hello"""`)
    })

    // =========================================================================
    // 8. Cross-account data isolation
    // =========================================================================
    await t.test('8. Cross-account data isolation is enforced', async () => {
      // Outsider queries reports projects: only Beta is returned, never Alpha
      const outsiderProjects = await reports.projects(outsiderId)
      assert.equal(outsiderProjects.projects.length, 1)
      assert.equal(outsiderProjects.projects[0].id, foreignProjectId)

      // Outsider attempts to query Alpha report: rejected with 404
      await assert.rejects(
        reports.project(outsiderId, projectId),
        err => err.code === 'not_found' && err.status === 404
      )

      // Owner attempts to query Beta report: rejected with 404
      await assert.rejects(
        reports.project(ownerId, foreignProjectId),
        err => err.code === 'not_found' && err.status === 404
      )

      // Outsider attempts to access Alpha directory: rejected with 404
      await assert.rejects(
        memberships.directory(outsiderId, { projectId, limit: '10', offset: '0' }),
        err => err.code === 'not_found' && err.status === 404
      )
    })

  } finally {
    await pool.end()
  }
})
