require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto'), fs = require('fs'), path = require('path')
const { Pool } = require('pg'), request = require('supertest')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const { createTaskRepository } = require('../src/db/taskRepository')
const { createTaskCommentRepository } = require('../src/db/taskCommentRepository')
const { createTaskActivityRepository } = require('../src/db/taskActivityRepository')
const { createMembershipRepository } = require('../src/db/membershipRepository')
const { createReportsRepository } = require('../src/db/reportsRepository')

test('disposable PostgreSQL assignments, comments and trigger-backed activity', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.SOURCE_TEST_DATABASE_URL
  const schema = 'publication_collaboration_' + crypto.randomBytes(8).toString('hex')
  const admin = new Pool({ connectionString, connectionTimeoutMillis: 3000 })
  let pool, restarted
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    const options = { connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 }
    pool = new Pool(options)
    await pool.query(fs.readFileSync(path.join(__dirname, '../scripts/create-users.sql'), 'utf8'))
    for (const name of ['0132-source-workspace.sql','0136-source-index.sql','0141-repository-reviews.sql','0142-repository-review-batches.sql','0143-review-scope-foundation.sql','0144-review-finding-type.sql','0145-project-documents.sql','0146-project-tasks.sql','0147-project-sprints.sql','0148-project-memberships.sql','0152-task-assignment.sql','0153-task-assignment-lifecycle.sql','0154-task-comments-activity.sql','0155-task-activity-producer.sql']) await pool.query(fs.readFileSync(path.join(__dirname, '../scripts/migrations', name), 'utf8'))
    const users = createTestRepository(), ids = {}, tokens = {}
    for (const name of ['owner','member','outsider']) {
      ids[name] = crypto.randomUUID()
      const user = { id: ids[name], fullName: `Synthetic ${name}`, email: `${name}@example.com`, role: 'Developer', tokenVersion: 0 }
      await pool.query('INSERT INTO users(id,full_name,email,role,password_hash) VALUES($1,$2,$3,$4,$5)', [user.id,user.fullName,user.email,user.role,'synthetic-no-login'])
      await users.createUser(user); tokens[name] = signToken(user)
    }
    await pool.query("INSERT INTO source_projects(id,owner_id,name) VALUES('synthetic-collaboration',$1,'Synthetic collaboration')", [ids.owner])
    await pool.query("INSERT INTO project_memberships(id,project_id,user_id,added_by,display_role) VALUES($1,'synthetic-collaboration',$2,$3,'Developer')", [crypto.randomUUID(),ids.member,ids.owner])
    const tasks = createTaskRepository(pool)
    const task = await tasks.create({ projectId: 'synthetic-collaboration', title: 'Synthetic task', description: '', status: 'To Do', priority: 'Medium' }, ids.owner)
    const taskId = task.id
    const appFor = p => createApp({ userRepository: users, taskRepository: createTaskRepository(p), taskCommentRepository: createTaskCommentRepository(p), taskActivityRepository: createTaskActivityRepository(p) })
    let app = appFor(pool)
    const call = (method, route, who, body) => {
      const req = request(app)[method](route).set('Authorization', `Bearer ${tokens[who]}`)
      return body ? req.send(body) : req
    }
    await t.test('member assignment persists; outsider is ineligible', async () => {
      const assigned = await tasks.update(taskId,ids.owner,{assigneeUserId:ids.member})
      assert.equal(assigned.assigneeUserId,ids.member)
      await assert.rejects(tasks.update(taskId,ids.owner,{assigneeUserId:ids.outsider}))
    })
    const commentUrl = `/api/project-tasks/${taskId}/comments`, activityUrl = `/api/project-tasks/${taskId}/activity`
    let saved
    await t.test('HTTP comment creation normalizes and deduplicates; conflict rejected', async () => {
      const clientRequestId = crypto.randomUUID()
      const first = await call('post',commentUrl,'owner',{body:'Synthetic\r\ncomment',clientRequestId})
      assert.equal(first.status,201); saved = first.body.comment
      assert.equal(saved.body,'Synthetic\ncomment'); assert.equal(saved.author.userId,ids.owner)
      const retry = await call('post',commentUrl,'owner',{body:'Synthetic\ncomment',clientRequestId})
      assert.equal(retry.status,200); assert.deepEqual(retry.body.comment,saved)
      assert.equal((await call('post',commentUrl,'owner',{body:'Different',clientRequestId})).status,409)
    })
    await t.test('owner-only policy denies member/outsider comment and activity access', async () => {
      for (const who of ['member','outsider']) {
        assert.equal((await call('get',commentUrl,who)).status,404)
        assert.equal((await call('get',activityUrl,who)).status,404)
      }
    })
    await t.test('status change creates trigger-backed activity', async () => {
      await tasks.update(taskId,ids.owner,{status:'In Progress'})
      const res = await call('get',activityUrl,'owner')
      assert.equal(res.status,200);assert.equal(res.headers['cache-control'],'no-store')
      assert.ok(res.body.activity.some(event => event.eventType === 'status_changed' && event.changes.from === 'To Do' && event.changes.to === 'In Progress'))
      assert.ok(res.body.activity.some(event => event.eventType === 'assignment_changed'))
    })
    await t.test('member sees shared directory; reports remain owner scoped and count tasks', async () => {
      const directory = await createMembershipRepository(pool).directory(ids.member,{projectId:'synthetic-collaboration',limit:'10',offset:'0'})
      assert.equal(directory.owner.userId,ids.owner);assert.equal(directory.members[0].userId,ids.member)
      const reports = createReportsRepository(pool)
      const report = await reports.project(ids.owner,'synthetic-collaboration')
      assert.equal(report.tasks.total,1);assert.equal(report.tasks.inProgress,1)
      await assert.rejects(reports.project(ids.member,'synthetic-collaboration'),e => e.code === 'not_found')
      await assert.rejects(reports.project(ids.outsider,'synthetic-collaboration'),e => e.code === 'not_found')
    })
    await t.test('new pool retains comments, assignment and activity', async () => {
      await pool.end();pool = null;restarted = new Pool(options);app = appFor(restarted)
      assert.deepEqual((await call('get',commentUrl,'owner')).body.comments[0],saved)
      assert.equal((await createTaskRepository(restarted).read(taskId,ids.owner)).assigneeUserId,ids.member)
      assert.ok((await call('get',activityUrl,'owner')).body.activity.length >= 3)
    })
    await t.test('removing membership clears assignment through the lifecycle trigger', async () => {
      const membership = (await restarted.query('SELECT id FROM project_memberships WHERE user_id=$1',[ids.member])).rows[0]
      await createMembershipRepository(restarted).remove(membership.id,ids.owner)
      assert.equal((await createTaskRepository(restarted).read(taskId,ids.owner)).assigneeUserId,null)
      const activity = (await call('get',activityUrl,'owner')).body.activity
      assert.ok(activity.some(event => event.reason === 'membership_removed' && event.changes.to === null))
    })
  } finally {
    await pool?.end();await restarted?.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()
  }
})
