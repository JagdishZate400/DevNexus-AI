# Test safety and scope

`npm test` in `backend/` runs the safe offline suite. Its runner strips inherited credentials and database settings, suppresses dotenv loading and rejects database calls. Each test worker gets its own temporary directory, so upload-cleanup assertions do not inspect another worker's files.

`npm run test:integration` requires `DEVNEXUS_TEST_DATABASE_URL`. The runner accepts only a loopback PostgreSQL endpoint on an explicit non-default port, a database named `devnexus_test_*`, a non-superuser role, and the exact database comment below:

```sql
COMMENT ON DATABASE devnexus_test_your_suffix
IS 'DevNexus publication disposable verification only';
```

Create this database on a **new disposable cluster**, with a dedicated role and no application data. Apply the documented fresh schema to that database. Do not relabel an existing development database as disposable. The comment is an operator assertion, not proof that the database contains no valuable data. The runner verifies the actual database, role, address, port and marker before spawning tests, and the child connection guard rejects other destinations. Integration tests create random schemas and may remove only those test schemas. The review also verified the server's new data directory before any connection that changed data.

Example after creating your disposable cluster and fresh database:

```powershell
$env:DEVNEXUS_TEST_DATABASE_URL = 'postgresql://test_user:YOUR_LOCAL_TEST_PASSWORD@127.0.0.1:YOUR_TEST_PORT/devnexus_test_your_suffix'
cd backend
npm run test:integration
```

The portable integration selection covers users/authentication, projects, source, retrieval, review persistence/batches, documentation persistence, tasks, sprints, memberships, comments, activity and reports. Provider calls are mocked; SMTP delivery is captured at the mailer seam. Other historical integration suites retain opt-in gates or fixed test-envelope assumptions and are not enabled by this runner. Three development-data regression suites and the old development ownership suite were excluded; a synthetic isolated ownership suite replaces the latter. Phase-specific Docker helpers and suites requiring private evidence files were excluded as operational artifacts.

From `frontend/`, run `npm run test:unit`, `npm run build` and `npm run lint`. Browser E2E files are provided but require their own fixtures/configuration and were not all executed in the publication review. The reviewed browser check only rendered the login form in a fresh browser context with external requests blocked. Do not treat it as full end-to-end verification.

The README records actual counts. Passing tests and a zero-advisory npm audit do not prove an absence of security vulnerabilities.
