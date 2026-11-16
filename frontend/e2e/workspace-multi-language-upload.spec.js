import { test, expect } from '@playwright/test'

const user = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'workspace-phase6@example.test',
  name: 'Workspace Lead',
  role: 'Developer',
}
const token = 'workspace-phase6-token'
const testProject = {
  id: 'phase6-multi-lang-project',
  name: 'Multi-Language Cloud Microservices',
}

async function setupWorkspace(page, { files = [], indexStats = null } = {}) {
  await page.addInitScript(
    ({ user, token }) => {
      sessionStorage.setItem('ai-assistant-tab-alive', '1')
      localStorage.setItem(
        'ai-assistant-auth',
        JSON.stringify({
          state: { user, token, rememberMe: true },
          version: 0,
        })
      )
    },
    { user, token }
  )

  // Default catch-all for background analytics/insights
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }))

  // Auth routes
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user } }))

  // Projects list
  await page.route('**/api/workspace/projects', (route) =>
    route.fulfill({ json: { projects: [testProject] } })
  )

  // Files in project
  await page.route(`**/api/workspace/projects/${testProject.id}/files`, (route) =>
    route.fulfill({ json: { files } })
  )

  // Indexing stats
  await page.route(`**/api/workspace/projects/${testProject.id}/index`, (route) =>
    route.fulfill({
      json:
        indexStats || {
          projectId: testProject.id,
          totalFiles: files.length,
          indexedFiles: files.length,
          pendingFiles: 0,
          chunkCount: files.length * 2,
          isIndexed: files.length > 0,
        },
    })
  )
}

test('Phase 6: Workspace renders 50 MiB upload modal with 15 language categories', async ({
  page,
}) => {
  await setupWorkspace(page)
  await page.goto('/workspace')

  // Verify Workspace header and project selection
  await expect(page.getByRole('heading', { name: 'Workspace', level: 2 })).toBeVisible({ timeout: 10000 })
  await expect(page.getByLabel('Project')).toHaveValue(testProject.id)

  // Open Upload Modal
  const uploadButton = page.getByRole('button', { name: /Upload ZIP/i })
  await expect(uploadButton).toBeEnabled()
  await uploadButton.click()

  // Verify Dialog presence and ARIA attributes
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('50 MiB Max')).toBeVisible()
  await expect(dialog.getByText('Multi-Language Workspace')).toBeVisible()
  await expect(dialog.getByText('Drop your ZIP archive here, or browse files')).toBeVisible()

  // Verify supported languages are visible
  for (const lang of ['Python', 'Go', 'Rust', 'Java', 'SQL', 'TypeScript', 'JavaScript']) {
    await expect(dialog.getByText(lang, { exact: true })).toBeVisible()
  }

  // Close modal via Cancel button
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
})

test('Phase 6: Client-side validation rejects non-ZIP and oversized archives', async ({
  page,
}) => {
  await setupWorkspace(page)
  await page.goto('/workspace')

  const uploadButton = page.getByRole('button', { name: /Upload ZIP/i })
  await expect(uploadButton).toBeEnabled()
  await uploadButton.click()

  const dialog = page.getByRole('dialog')
  const fileInput = dialog.locator('input[type="file"]')

  // Upload a .tar file (invalid extension)
  await fileInput.setInputFiles({
    name: 'project-source.tar',
    mimeType: 'application/x-tar',
    buffer: Buffer.from('not a zip archive'),
  })

  await expect(dialog.getByRole('alert')).toContainText('Only .zip archives are supported')
  await expect(dialog.getByRole('button', { name: /Upload & Index Project/i })).toBeDisabled()

  // Upload an empty zip file (0 bytes)
  await fileInput.setInputFiles({
    name: 'empty.zip',
    mimeType: 'application/zip',
    buffer: Buffer.alloc(0),
  })

  await expect(dialog.getByRole('alert')).toContainText('empty (0 bytes)')
  await expect(dialog.getByRole('button', { name: /Upload & Index Project/i })).toBeDisabled()
})

test('Phase 6: Re-upload displays non-destructive merge and delete-missing confirmation', async ({
  page,
}) => {
  const existingFiles = [
    {
      id: 'f-1',
      path: 'src/main.py',
      language: 'Python',
      byteSize: 1200,
      uploadedAt: new Date().toISOString(),
    },
    {
      id: 'f-2',
      path: 'pkg/service.go',
      language: 'Go',
      byteSize: 3400,
      uploadedAt: new Date().toISOString(),
    },
  ]

  await setupWorkspace(page, { files: existingFiles })
  await page.goto('/workspace')

  await page.getByRole('button', { name: /Upload ZIP/i }).click()
  const dialog = page.getByRole('dialog')

  // Check that Re-Upload synchronization options appear
  await expect(dialog.getByRole('heading', { name: 'Synchronize Project Source' })).toBeVisible()
  await expect(dialog.getByText('Incremental Re-Upload Synchronization')).toBeVisible()
  await expect(dialog.getByText('Non-Destructive Merge (Recommended)')).toBeVisible()
  await expect(dialog.getByText('Full Mirror Synchronization (Delete Missing)')).toBeVisible()

  // Select a valid ZIP
  const fileInput = dialog.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'update.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK\x03\x04mockzipcontent'),
  })

  // By default, Non-Destructive Merge is selected, upload button is enabled
  const submitButton = dialog.getByRole('button', { name: /Synchronize Project Source/i })
  await expect(submitButton).toBeEnabled()

  // Switch to Delete Missing mode
  await dialog.getByLabel('Full Mirror Synchronization (Delete Missing)').check()
  await expect(dialog.getByText('Permanent File Removal Warning')).toBeVisible()
  // Button should be disabled until checkbox is checked
  await expect(submitButton).toBeDisabled()

  // Check confirmation box
  await dialog.getByLabel('I understand that missing files will be permanently deleted').check()
  await expect(submitButton).toBeEnabled()
})

test('Phase 6: Sync preview displays breakdown of new, modified, unchanged, and missing files', async ({
  page,
}) => {
  const existingFiles = [
    {
      id: 'f-1',
      path: 'server/app.py',
      language: 'Python',
      byteSize: 1000,
      uploadedAt: new Date().toISOString(),
    },
  ]

  await setupWorkspace(page, { files: existingFiles })

  // Mock previewSync API response
  await page.route(`**/api/workspace/projects/${testProject.id}/sync/preview*`, (route) => {
    return route.fulfill({
      json: {
        summary: { added: 3, updated: 1, unchanged: 2, removed: 0, preserved: 2, excluded: 1 },
        addedFiles: ['client/src/App.tsx', 'api/routes.go', 'db/schema.sql'],
        updatedFiles: ['server/app.py'],
        unchangedFiles: ['README.md', 'LICENSE'],
        removedFiles: [],
        preservedFiles: ['README.md', 'LICENSE'],
        excludedFiles: ['node_modules/pkg/index.js'],
        syncMode: 'merge',
        existingCount: 3,
        uploadCount: 6,
      },
    })
  })

  await page.goto('/workspace')
  await page.getByRole('button', { name: /Upload ZIP/i }).click()

  const dialog = page.getByRole('dialog')
  const fileInput = dialog.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'microservices.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK\x03\x04mockcontent'),
  })

  // Click Analyze & Preview Changes
  const previewButton = dialog.getByRole('button', { name: /Analyze & Preview Sync Changes/i })
  await expect(previewButton).toBeVisible()
  await previewButton.click()

  // Verify Preview Breakdown pills
  await expect(dialog.getByText('Synchronization Preview')).toBeVisible()
  await expect(dialog.getByText('+3')).toBeVisible() // added
  await expect(dialog.getByText('~1')).toBeVisible() // updated
  await expect(dialog.getByRole('button', { name: /Unchanged/i })).toContainText('=2')
  await expect(dialog.getByText('⊘1')).toBeVisible() // excluded

  // Click Added pill to inspect paths
  await dialog.getByRole('button', { name: /New Files/i }).click()
  await expect(dialog.getByText('+ client/src/App.tsx')).toBeVisible()
  await expect(dialog.getByText('+ api/routes.go')).toBeVisible()
  await expect(dialog.getByText('+ db/schema.sql')).toBeVisible()
})

test('Phase 6: Upload progress transitions to asynchronous indexing progress with live updates', async ({
  page,
}) => {
  await setupWorkspace(page)

  // Mock Upload API
  await page.route(`**/api/workspace/projects/${testProject.id}/upload*`, (route) => {
    return route.fulfill({
      status: 201,
      json: {
        uploadedFiles: 10,
        uploadedBytes: 25000,
        summary: { added: 10, updated: 0, unchanged: 0, removed: 0, preserved: 0 },
        files: [],
      },
    })
  })

  // Mock indexing status sequence: processing (50%) -> completed (100%)
  let pollCount = 0
  await page.route(`**/api/workspace/projects/${testProject.id}/indexing/status`, (route) => {
    pollCount++
    if (pollCount === 1) {
      return route.fulfill({
        json: {
          id: 'job-1',
          projectId: testProject.id,
          status: 'processing',
          progress: {
            totalFiles: 10,
            processedFiles: 5,
            indexedFiles: 5,
            failedFiles: 0,
            excludedFiles: 0,
            currentBatch: 1,
            totalBatches: 2,
            percentage: 50,
          },
        },
      })
    }
    return route.fulfill({
      json: {
        id: 'job-1',
        projectId: testProject.id,
        status: 'completed',
        progress: {
          totalFiles: 10,
          processedFiles: 10,
          indexedFiles: 10,
          failedFiles: 0,
          excludedFiles: 0,
          currentBatch: 2,
          totalBatches: 2,
          percentage: 100,
        },
      },
    })
  })

  await page.goto('/workspace')
  await page.getByRole('button', { name: /Upload ZIP/i }).click()

  const dialog = page.getByRole('dialog')
  const fileInput = dialog.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'project-full.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK\x03\x04mockzipdata'),
  })

  // Submit upload
  await dialog.getByRole('button', { name: /Upload & Index Project/i }).click()

  // Verify transition to Indexing Progress
  await expect(dialog.getByText('Asynchronous Source Indexing')).toBeVisible()

  // Wait for completed state
  await expect(dialog.getByText('Upload & Indexing Complete!')).toBeVisible()
  await expect(dialog.getByText('All source files have been parsed, chunked, and committed')).toBeVisible()

  // Click Explore Workspace Files to close
  await dialog.getByRole('button', { name: /Explore Workspace Files/i }).click()
  await expect(dialog).toHaveCount(0)
})
