// Safe default: no .env loading or database access. Integration requires an
// explicitly marked disposable database, verified before child tests start.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { Client } = require('pg')
const root = path.resolve(__dirname, '..')
const integration = process.argv.includes('--integration')
async function main() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/DATABASE_URL|API_KEY|JWT_SECRET|SMTP_|APPROVED|AI_PROVIDER|AI_SERVICE_URL|NODE_OPTIONS/.test(key)) delete env[key]
  }
  if (integration) {
    const raw = process.env.DEVNEXUS_TEST_DATABASE_URL
    if (!raw) throw new Error('Set DEVNEXUS_TEST_DATABASE_URL to a new marked disposable database.')
    const url = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !url.port || url.port === '5432' || !/^\/devnexus_test_[a-z0-9_]+$/.test(url.pathname) || url.search || url.hash) throw new Error('Disposable database URL failed safety checks.')
    const client = new Client({ connectionString: raw, connectionTimeoutMillis: 3000 })
    try {
      await client.connect()
      const row = (await client.query("SELECT current_database() AS db,current_user AS role,inet_server_addr()::text AS host,inet_server_port() AS port,pg_is_in_recovery() AS recovery,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()" )).rows[0]
      if (row.db !== url.pathname.slice(1) || row.role !== decodeURIComponent(url.username) || row.host !== '127.0.0.1/32' && row.host !== '127.0.0.1' || row.port !== Number(url.port) || row.recovery || row.superuser || row.marker !== 'DevNexus publication disposable verification only') throw new Error('Disposable database identity/marker failed verification.')
    } finally { await client.end() }
    env.DEVNEXUS_TEST_DATABASE_URL = raw
    for (const key of ['SOURCE_TEST_DATABASE_URL','DOCUMENT_TEST_DATABASE_URL','TASK_TEST_DATABASE_URL','SPRINT_TEST_DATABASE_URL','MEMBERSHIP_TEST_DATABASE_URL']) env[key] = raw
    env.DATABASE_URL = raw
  } else delete env.DEVNEXUS_TEST_DATABASE_URL
  const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.js')).sort()
  const selected = integration ? tests.filter(name => [
    'source-postgres.test.js','source-index-postgres.test.js','review-postgres.test.js',
    'review-batch-postgres.test.js','project-review-batch-postgres.test.js',
    'review-batch-finalization-postgres.test.js','review-discovery-postgres.test.js',
    'review-scope-postgres.test.js','project-documents-postgres.test.js',
    'project-tasks-postgres.test.js','project-sprints-postgres.test.js',
    'project-members-postgres.test.js','ai-conversations-isolated.test.js',
    'source-multi-language-isolated.test.js', 'publication-ownership-postgres.test.js',
    'publication-collaboration-postgres.test.js',
    'publication-auth-postgres.test.js',
  ].includes(name)) : tests
  const result = spawnSync(process.execPath, ['--require', path.join(root, 'tests/helpers/publication-guard.js'), '--test', '--test-timeout=60000', ...selected.map(name => path.join(root, 'tests', name))], { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
main().catch(() => { console.error('Test setup failed: use only an explicitly marked disposable database for integration.'); process.exitCode = 1 })
