// Explicit administrative backfill, using each stored project's owner binding.
require('../src/config')
const { Pool } = require('pg')
const { createSourceRepository } = require('../src/db/sourceRepository')
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('configuration')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 30000 })
  try {
    const projects = (await pool.query('SELECT id, owner_id FROM source_projects ORDER BY id')).rows
    const repository = createSourceRepository(pool)
    const counts = { projects: 0, indexedFiles: 0, excludedFiles: 0, chunkCount: 0 }
    for (const project of projects) {
      const stats = await repository.indexProject(project.id, project.owner_id)
      counts.projects++; counts.indexedFiles += stats.indexedFiles; counts.excludedFiles += stats.excludedFiles; counts.chunkCount += stats.chunkCount
    }
    console.log(JSON.stringify(counts))
  } finally { await pool.end() }
}
main().catch(() => { console.error('Source backfill failed. Earlier projects may have completed; rerunning is safe. Check PostgreSQL and apply the Phase B migration.'); process.exitCode = 1 })
