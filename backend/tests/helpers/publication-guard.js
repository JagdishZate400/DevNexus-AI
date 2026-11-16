// Child-test preload: .env must never influence tests.
require('dotenv').config = () => ({ parsed: {} })
// Parallel test workers must not count or remove each other's upload files.
const fs = require('fs'), os = require('os'), path = require('path')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'devnexus-test-worker-'))
process.env.TEMP = temporary
process.env.TMP = temporary
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'publication-test-only-secret-32-characters', SMTP_MODE: 'console', DEMO_VERIFICATION_CODE: '123456' })
const pg = require('pg')
const allowed = process.env.DEVNEXUS_TEST_DATABASE_URL
if (!allowed) {
  for (const key of Object.keys(process.env)) if (/DATABASE_URL|APPROVED/.test(key)) delete process.env[key]
  for (const Type of [pg.Pool, pg.Client]) {
    Type.prototype.connect = async function () { throw new Error('Offline tests cannot connect to a database') }
    Type.prototype.query = async function () { throw new Error('Offline tests cannot query a database') }
  }
} else {
  const target = new URL(allowed)
  const connect = pg.Client.prototype.connect
  pg.Client.prototype.connect = function (...args) {
    const p = this.connectionParameters
    if (p.host !== target.hostname || Number(p.port) !== Number(target.port) || p.database !== target.pathname.slice(1) || p.user !== decodeURIComponent(target.username)) throw new Error('Test attempted a connection outside the verified disposable database')
    return connect.apply(this, args)
  }
}
