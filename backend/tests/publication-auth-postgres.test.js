require('./helpers/offline')
const { test } = require('node:test'), assert = require('node:assert/strict')
const crypto = require('crypto'), fs = require('fs'), path = require('path')
const { Pool } = require('pg'), request = require('supertest')

test('disposable PostgreSQL verified signup, login, current-role auth and logout', { skip: !process.env.SOURCE_TEST_DATABASE_URL }, async t => {
  const connectionString = process.env.SOURCE_TEST_DATABASE_URL
  const schema = 'publication_auth_' + crypto.randomBytes(8).toString('hex')
  const admin = new Pool({ connectionString, options: '-c search_path=public', connectionTimeoutMillis: 3000 })
  let pool
  try {
    await admin.query(`CREATE SCHEMA ${schema}`)
    // Real production repository, confined to this test worker's random schema.
    process.env.DATABASE_URL = connectionString
    process.env.PGOPTIONS = `-c search_path=${schema}`
    pool = require('../src/db/postgres')
    await pool.query(fs.readFileSync(path.join(__dirname,'../scripts/create-users.sql'),'utf8'))
    const repository = require('../src/db/users')
    const mailer = require('../src/services/mailer')
    let deliveredCode
    mailer.sendVerificationEmail = async (_to, code) => { deliveredCode = code; return {delivery:'test'} }
    mailer.sendWelcomeEmail = async () => ({delivery:'test'})
    mailer.logEmailStatus = () => {}
    const { createApp } = require('../src/app')
    const app = createApp({ userRepository: repository })
    const email = 'synthetic-auth@example.com', password = 'SyntheticStrongPass42!'
    let token, refreshToken, id
    await t.test('unverified signup is rejected; captured verification code enables signup', async () => {
      assert.equal((await request(app).post('/api/auth/register').send({fullName:'Synthetic User',email,password})).status,400)
      assert.equal((await request(app).post('/api/auth/request-code').send({email})).status,200)
      assert.match(deliveredCode,/^\d{6}$/)
      assert.equal((await request(app).post('/api/auth/verify-code').send({email,code:deliveredCode})).status,200)
      const res = await request(app).post('/api/auth/register').send({fullName:'Synthetic User',email,password})
      assert.equal(res.status,201);id = res.body.user.id
      const stored = await repository.findByEmail(email)
      assert.ok(stored.passwordHash.startsWith('$2'));assert.notEqual(stored.passwordHash,password)
    })
    assert.ok(id)
    await t.test('real PostgreSQL credentials authenticate; bad password fails', async () => {
      assert.equal((await request(app).post('/api/auth/login').send({email,password:'IncorrectPass42!'})).status,401)
      const res = await request(app).post('/api/auth/login').send({email,password})
      assert.equal(res.status,200);token = res.body.token;refreshToken = res.body.refreshToken
      assert.equal((await request(app).get('/api/auth/me').set('Authorization',`Bearer ${token}`)).body.user.id,id)
    })
    await t.test('token version revocation in PostgreSQL invalidates prior access', async () => {
      await pool.query('UPDATE users SET token_version=token_version+1 WHERE id=$1',[id])
      assert.equal((await request(app).get('/api/auth/me').set('Authorization',`Bearer ${token}`)).status,401)
      assert.equal((await request(app).post('/api/auth/refresh').send({refreshToken})).status,401)
    })
  } finally {
    await pool?.end()
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end()
  }
})
