require('./helpers/offline')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')
const request = require('supertest')
const { createApp } = require('../src/app')
const { createTestRepository } = require('./helpers/users')
const { signToken } = require('../src/middleware/auth')
const { createProjectRepository } = require('../src/db/projectRepository')

test('disposable PostgreSQL project ownership enforces separation and survives pool recreation', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async t => {
  const raw = process.env.SOURCE_TEST_DATABASE_URL
  const schema = 'publication_ownership_' + crypto.randomBytes(8).toString('hex')
  const admin = new Pool({ connectionString: raw, connectionTimeoutMillis: 3000 })
  let pool, restarted
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    const options = { connectionString: raw, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000 }
    pool = new Pool(options)
    for (const file of ['create-users.sql', 'migrations/0132-source-workspace.sql', 'migrations/0146-project-tasks.sql', 'migrations/0147-project-sprints.sql', 'migrations/0148-project-memberships.sql', 'migrations/0161-project-metadata.sql']) await pool.query(fs.readFileSync(path.join(__dirname, '../scripts', file), 'utf8'))
    const users = createTestRepository(), tokens = {}, ids = {}
    for (const [name, role] of [['alice','Developer'], ['bob','Developer'], ['lead','Team Lead']]) {
      const id = crypto.randomUUID(), email = `${name}@example.com`
      ids[name] = id
      await pool.query('INSERT INTO users(id,full_name,email,role,password_hash) VALUES($1,$2,$3,$4,$5)', [id,name,email,role,'synthetic-test-only'])
      const user = { id, fullName: name, email, role, tokenVersion: 0 }
      await users.createUser(user); tokens[name] = signToken(user)
    }
    const appFor = p => createApp({ userRepository: users, projectRepository: createProjectRepository(p) })
    let app = appFor(pool)
    const call = (method, route, who, body) => {
      const req = request(app)[method](route).set('Authorization', `Bearer ${tokens[who]}`)
      return body ? req.send(body) : req
    }
    let id
    await t.test('owner creates a durable project', async () => {
      const res = await call('post','/api/projects','alice',{name:'Synthetic Alpha',description:'Disposable ownership test',stack:['Node.js'],status:'Active',progress:20})
      assert.equal(res.status,201); id = res.body.project.id
      assert.equal((await pool.query('SELECT owner_id FROM source_projects WHERE id=$1',[id])).rows[0].owner_id,ids.alice)
    })
    assert.ok(id)
    await t.test('another developer cannot read/update/delete it; leads have metadata management but cannot delete', async () => {
      for (const who of ['bob']) {
        for (const [method,body] of [['get',null],['patch',{name:'Unauthorized'}],['delete',null]]) {
          const res = await call(method,`/api/projects/${id}`,who,body)
          assert.ok([403,404].includes(res.status), `${who} ${method}: ${res.status}`)
        }
      }
      assert.equal((await call('get',`/api/projects/${id}`,'lead')).status,200)
      assert.equal((await call('patch',`/api/projects/${id}`,'lead',{description:'Lead-reviewed synthetic project'})).status,200)
      assert.equal((await call('delete',`/api/projects/${id}`,'lead')).status,403)
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM source_projects WHERE id=$1',[id])).rows[0].n,1)
    })
    await t.test('owner updates persisted metadata', async () => {
      assert.equal((await call('patch',`/api/projects/${id}`,'alice',{description:'Updated synthetic description',progress:40})).status,200)
      assert.equal((await pool.query('SELECT progress FROM source_projects WHERE id=$1',[id])).rows[0].progress,40)
    })
    await t.test('new pool retains project and owner can delete it', async () => {
      await pool.end(); pool = null; restarted = new Pool(options); app = appFor(restarted)
      assert.equal((await call('get',`/api/projects/${id}`,'alice')).body.project.progress,40)
      assert.equal((await call('delete',`/api/projects/${id}`,'alice')).status,204)
      assert.equal((await restarted.query('SELECT count(*)::int AS n FROM source_projects WHERE id=$1',[id])).rows[0].n,0)
    })
  } finally {
    await pool?.end(); await restarted?.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await admin.end()
  }
})
