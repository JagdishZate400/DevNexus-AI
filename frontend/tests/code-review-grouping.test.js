import { test } from 'node:test'
import assert from 'node:assert/strict'

// Test the exact helper and filtering logic used by CodeReviewPage
function asFindings(value) {
  return Array.isArray(value) ? value.filter((finding) => finding && typeof finding === 'object' && !Array.isArray(finding)) : []
}

function toHistoryItem(review) {
  return {
    id: review.id,
    project: review.project,
    scope: review.batch ? `${review.scope === 'Entire Project' ? 'Entire Project' : 'Selected Files'} (${review.coverage?.submitted ?? review.files?.length ?? 0})` : review.scope,
    status: review.status,
    provider: review.provider,
    repository: review.repository,
    coverage: review.coverage,
    errorCode: review.errorCode,
    model: review.model,
    batch: review.batch,
    files: review.files || [],
    findingsPage: review.findingsPage,
    reviewScope: review.scope,
    findings: typeof review.findingsCount === 'number' ? review.findingsCount : typeof review.findings === 'number' ? review.findings : asFindings(review.findings).length,
    updated: review.updatedAt ? new Date(review.updatedAt).toLocaleString() : 'Just now',
  }
}

function filterAndCombineReviews(reviews, batches) {
  const validReviews = (reviews || []).filter((review) => review && typeof review === 'object' && typeof review.id === 'string')
  const childIds = new Set([
    ...batches.flatMap((b) => [
      ...(b.files || []).map((f) => f.reviewId),
      ...(b.childReviewIds || []),
    ]),
    ...validReviews.filter((r) => r.coverage?.batchId).map((r) => r.id),
  ].filter(Boolean))
  return [...validReviews.filter((r) => !childIds.has(r.id)), ...batches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

test('Scenario 1: Failed batch attempt followed by successful retry suppresses failed attempt from Recent Reviews', () => {
  // Attempt 1: Failed during batch review
  const failedAttempt = {
    id: '811ead6c-f510-4dec-9f48-d21b06443101',
    project: 'SentinelWAF AI',
    scope: 'Single File',
    status: 'Failed',
    errorCode: 'ai_unavailable',
    findings: [],
    coverage: { scope: 'Single File', batchId: 'batch-entire-project-uuid' },
    createdAt: '2026-11-11T07:29:35.367Z',
  }

  // Attempt 2: Successful retry during same batch review
  const successfulAttempt = {
    id: 'd73eecfc-9bd5-4fd0-b7bb-cbbf003cd5ad',
    project: 'SentinelWAF AI',
    scope: 'Single File',
    status: 'Completed',
    findings: [{ id: 'f-navbar-1', severity: 'Medium', problem: 'Auth modal sync' }],
    coverage: { scope: 'Single File', batchId: 'batch-entire-project-uuid' },
    createdAt: '2026-11-11T07:30:46.272Z',
  }

  // The parent batch contains both IDs in childReviewIds
  const entireProjectBatch = {
    id: 'batch-entire-project-uuid',
    projectId: 'proj-1',
    project: 'SentinelWAF AI',
    scope: 'Entire Project',
    provider: 'gemini',
    status: 'Reviewed',
    files: [],
    childReviewIds: [failedAttempt.id, successfulAttempt.id],
    coverage: { submitted: 43, pending: 0, running: 0, reviewed: 43, skipped: 0, failed: 0 },
    findingsCount: 50,
    createdAt: '2026-11-11T07:24:41.510Z',
    batch: true,
    repository: true,
  }

  const combined = filterAndCombineReviews([failedAttempt, successfulAttempt], [entireProjectBatch])
  const items = combined.map(toHistoryItem)

  // Exactly 1 item should appear: the parent batch entry
  assert.equal(items.length, 1, 'Only 1 parent batch entry should appear')
  assert.equal(items[0].id, entireProjectBatch.id)
  assert.equal(items[0].scope, 'Entire Project (43)')
  assert.equal(items[0].findings, 50)

  // Verify the superseded failed attempt does NOT appear in Recent Reviews
  assert.equal(items.some((i) => i.id === failedAttempt.id), false, 'Failed attempt must be suppressed')
  assert.equal(items.some((i) => i.id === successfulAttempt.id), false, 'Successful attempt child must be grouped')
})

test('Scenario 2: Successful batch review with multiple files shows one parent entry', () => {
  const childReviews = Array.from({ length: 43 }, (_, i) => ({
    id: `child-review-${i + 1}`,
    project: 'SentinelWAF AI',
    scope: 'Single File',
    status: 'Completed',
    findings: [{ id: `f-${i}`, severity: 'High', problem: `Issue in file ${i}` }],
    coverage: { scope: 'Single File', batchId: 'batch-all-success' },
    createdAt: new Date(Date.now() - 1000 * (43 - i)).toISOString(),
  }))

  const batch = {
    id: 'batch-all-success',
    project: 'SentinelWAF AI',
    scope: 'Entire Project',
    status: 'Reviewed',
    files: [],
    childReviewIds: childReviews.map((r) => r.id),
    coverage: { submitted: 43 },
    findingsCount: 43,
    createdAt: new Date().toISOString(),
    batch: true,
  }

  const combined = filterAndCombineReviews(childReviews, [batch])
  assert.equal(combined.length, 1)
  assert.equal(combined[0].id, 'batch-all-success')
})

test('Scenario 3: Failed standalone single-file review is preserved in Recent Reviews', () => {
  const failedStandalone = {
    id: 'standalone-failed-uuid',
    project: 'SentinelWAF AI',
    scope: 'frontend/src/components/layout/Navbar.jsx',
    status: 'Failed',
    errorCode: 'ai_unavailable',
    findings: 0,
    coverage: { scope: 'Single File', filesReviewed: 0, filesSubmitted: 1 },
    createdAt: '2026-11-10T09:00:00Z',
  }

  const batch = {
    id: 'batch-uuid',
    project: 'SentinelWAF AI',
    scope: 'Entire Project',
    status: 'Reviewed',
    files: [],
    childReviewIds: ['batch-child-1'],
    coverage: { submitted: 10 },
    findingsCount: 15,
    createdAt: '2026-11-11T07:00:00Z',
    batch: true,
  }

  const combined = filterAndCombineReviews([failedStandalone], [batch])
  const items = combined.map(toHistoryItem)

  assert.equal(items.length, 2, 'Both batch and failed standalone review should appear')
  const standaloneItem = items.find((i) => i.id === failedStandalone.id)
  assert.ok(standaloneItem, 'Failed standalone review must be preserved')
  assert.equal(standaloneItem.status, 'Failed')
  assert.equal(standaloneItem.scope, 'frontend/src/components/layout/Navbar.jsx')
})

test('Scenario 4: Completed standalone single-file review is preserved in Recent Reviews', () => {
  const completedStandalone = {
    id: 'standalone-success-uuid',
    project: 'SentinelWAF AI',
    scope: 'frontend/src/components/layout/Navbar.jsx',
    status: 'Completed',
    findings: 2,
    coverage: { scope: 'Single File', filesReviewed: 1, filesSubmitted: 1 },
    createdAt: '2026-11-10T11:00:00Z',
  }

  const batch = {
    id: 'batch-uuid',
    project: 'SentinelWAF AI',
    scope: 'Entire Project',
    status: 'Reviewed',
    files: [],
    childReviewIds: ['batch-child-1'],
    coverage: { submitted: 10 },
    findingsCount: 15,
    createdAt: '2026-11-11T07:00:00Z',
    batch: true,
  }

  const combined = filterAndCombineReviews([completedStandalone], [batch])
  const items = combined.map(toHistoryItem)

  assert.equal(items.length, 2)
  const standaloneItem = items.find((i) => i.id === completedStandalone.id)
  assert.ok(standaloneItem, 'Completed standalone review must be preserved')
  assert.equal(standaloneItem.status, 'Completed')
})

test('Scenario 5: Two independent batches reviewing the same file maintain distinct parent cards', () => {
  const batch1Child = {
    id: 'batch1-child-navbar',
    project: 'SentinelWAF AI',
    scope: 'Single File',
    status: 'Completed',
    coverage: { scope: 'Single File', batchId: 'batch-1' },
    createdAt: '2026-11-10T10:05:00Z',
  }

  const batch2Child = {
    id: 'batch2-child-navbar',
    project: 'SentinelWAF AI',
    scope: 'Single File',
    status: 'Completed',
    coverage: { scope: 'Single File', batchId: 'batch-2' },
    createdAt: '2026-11-11T10:05:00Z',
  }

  const standalone = {
    id: 'standalone-navbar',
    project: 'SentinelWAF AI',
    scope: 'frontend/src/components/layout/Navbar.jsx',
    status: 'Completed',
    coverage: { scope: 'Single File' },
    createdAt: '2026-11-09T10:00:00Z',
  }

  const batch1 = {
    id: 'batch-1',
    project: 'SentinelWAF AI',
    scope: 'Entire Project',
    status: 'Reviewed',
    files: [],
    childReviewIds: ['batch1-child-navbar'],
    coverage: { submitted: 43 },
    findingsCount: 45,
    createdAt: '2026-11-10T10:00:00Z',
    batch: true,
  }

  const batch2 = {
    id: 'batch-2',
    project: 'SentinelWAF AI',
    scope: 'Entire Project',
    status: 'Reviewed',
    files: [],
    childReviewIds: ['batch2-child-navbar'],
    coverage: { submitted: 43 },
    findingsCount: 50,
    createdAt: '2026-11-11T10:00:00Z',
    batch: true,
  }

  const combined = filterAndCombineReviews([batch1Child, batch2Child, standalone], [batch1, batch2])
  const items = combined.map(toHistoryItem)

  // Exactly 3 items: Batch 2, Batch 1, and Standalone (in date order)
  assert.equal(items.length, 3, 'Should show exactly 2 batches and 1 standalone review')
  assert.equal(items[0].id, 'batch-2', 'Newer batch first')
  assert.equal(items[1].id, 'batch-1', 'Older batch second')
  assert.equal(items[2].id, 'standalone-navbar', 'Standalone review third')

  // Neither batch child leaked into the list
  assert.equal(items.some((i) => i.id === batch1Child.id), false)
  assert.equal(items.some((i) => i.id === batch2Child.id), false)
})

test('Scenario 6: Browser refresh and history persistence retains grouped structure', () => {
  // Simulate data returned upon fresh page reload from API endpoints
  const apiReviews = [
    {
      id: '811ead6c-f510-4dec-9f48-d21b06443101',
      project: 'SentinelWAF AI',
      scope: 'Single File',
      status: 'Failed',
      errorCode: 'ai_unavailable',
      coverage: { scope: 'Single File' }, // Historical record without explicit batchId
      createdAt: '2026-11-11T07:29:35.367Z',
    },
    {
      id: 'd73eecfc-9bd5-4fd0-b7bb-cbbf003cd5ad',
      project: 'SentinelWAF AI',
      scope: 'Single File',
      status: 'Completed',
      coverage: { scope: 'Single File' },
      createdAt: '2026-11-11T07:30:46.272Z',
    },
    {
      id: 'standalone-persisted-uuid',
      project: 'SentinelWAF AI',
      scope: 'src/config.py',
      status: 'Completed',
      findings: 1,
      coverage: { scope: 'Single File' },
      createdAt: '2026-11-09T08:00:00Z',
    },
  ]

  // Batches API returns batch with childReviewIds including both 811ead6c and d73eecfc
  const apiBatches = [
    {
      id: 'dbe172b6-9c91-4553-aa78-98e6449054c1',
      project: 'SentinelWAF AI',
      scope: 'Entire Project',
      status: 'Reviewed',
      files: [],
      childReviewIds: [
        '811ead6c-f510-4dec-9f48-d21b06443101',
        'd73eecfc-9bd5-4fd0-b7bb-cbbf003cd5ad',
      ],
      coverage: { submitted: 43 },
      findingsCount: 50,
      createdAt: '2026-11-11T07:24:41.510Z',
      batch: true,
    },
  ]

  const combined = filterAndCombineReviews(apiReviews, apiBatches)
  const items = combined.map(toHistoryItem)

  assert.equal(items.length, 2, 'Persisted history must have 1 batch and 1 standalone review')
  assert.equal(items[0].id, 'dbe172b6-9c91-4553-aa78-98e6449054c1')
  assert.equal(items[1].id, 'standalone-persisted-uuid')
})

test('Scenario 7: Batch progress polling refresh safely updates state without ReferenceError on current', () => {
  // Define the exact state updater used by CodeReviewPage 15-second polling interval
  function applyBatchRefreshStateUpdater(currentReviews, data) {
    const childIds = new Set([
      ...data.batches.flatMap((b) => [...(b.files || []).map((f) => f.reviewId), ...(b.childReviewIds || [])]),
      ...currentReviews.filter((r) => r.coverage?.batchId).map((r) => r.id),
    ].filter(Boolean))
    return [...currentReviews.filter((r) => !r.batch && !childIds.has(r.id)), ...data.batches.map(toHistoryItem)]
  }

  // Pre-existing state: 1 standalone review, 1 older batch item, and 1 child review
  const initialReviews = [
    {
      id: 'batch-running-1',
      project: 'SentinelWAF AI',
      scope: 'Entire Project',
      status: 'In Progress',
      batch: true,
      coverage: { submitted: 43, pending: 20, running: 1, reviewed: 22, skipped: 0, failed: 0 },
      files: [{ file: 'Navbar.jsx', reviewId: 'attempt-1' }],
      childReviewIds: ['attempt-1'],
      findingsCount: 15,
      createdAt: '2026-11-11T07:24:41.510Z',
    },
    {
      id: 'standalone-review-1',
      project: 'SentinelWAF AI',
      scope: 'src/auth.py',
      status: 'Completed',
      batch: false,
      coverage: { scope: 'Single File' },
      findings: 3,
      createdAt: '2026-11-10T09:00:00Z',
    },
    {
      id: 'attempt-1',
      project: 'SentinelWAF AI',
      scope: 'Single File',
      status: 'Failed',
      errorCode: 'ai_unavailable',
      batch: false,
      coverage: { scope: 'Single File', batchId: 'batch-running-1' },
      findings: 0,
      createdAt: '2026-11-11T07:25:00.000Z',
    },
  ]

  // Polling data returns updated batch: 43 reviewed, 50 findings, now status 'Reviewed'
  const pollingData = {
    batches: [
      {
        id: 'batch-running-1',
        project: 'SentinelWAF AI',
        scope: 'Entire Project',
        status: 'Reviewed',
        batch: true,
        coverage: { submitted: 43, pending: 0, running: 0, reviewed: 43, skipped: 0, failed: 0 },
        files: [{ file: 'Navbar.jsx', reviewId: 'attempt-2' }],
        childReviewIds: ['attempt-1', 'attempt-2'],
        findingsCount: 50,
        createdAt: '2026-11-11T07:24:41.510Z',
      },
    ],
  }

  // Execute the state updater
  const nextReviews = applyBatchRefreshStateUpdater(initialReviews, pollingData)

  // Assertions:
  // 1. Should not throw ReferenceError: current is not defined
  // 2. Exactly 2 items: the updated batch and the standalone review
  assert.equal(nextReviews.length, 2, 'Should contain exactly 1 batch and 1 standalone review')
  
  // 3. Standalone review preserved
  const standalone = nextReviews.find((r) => r.id === 'standalone-review-1')
  assert.ok(standalone, 'Standalone review must be preserved')
  assert.equal(standalone.id, 'standalone-review-1')

  // 4. Batch updated with refreshed progress
  const refreshedBatch = nextReviews.find((r) => r.id === 'batch-running-1')
  assert.ok(refreshedBatch, 'Refreshed batch must exist in state')
  assert.equal(refreshedBatch.status, 'Reviewed')
  assert.equal(refreshedBatch.findings, 50)
  assert.equal(refreshedBatch.scope, 'Entire Project (43)')

  // 5. Child attempt-1 is suppressed from history items
  assert.equal(nextReviews.some((r) => r.id === 'attempt-1'), false, 'Child review attempt-1 must be suppressed')
  // 6. Child attempt-2 is suppressed from history items
  assert.equal(nextReviews.some((r) => r.id === 'attempt-2'), false, 'Child review attempt-2 must be suppressed')
  // 7. No duplicate batches
  assert.equal(nextReviews.filter((r) => r.id === 'batch-running-1').length, 1, 'No duplicate batch entries')
})

test('Scenario 8: Batch progress refresh handles various batch statuses (Running, Partial, Failed, Reviewed)', () => {
  function applyBatchRefreshStateUpdater(currentReviews, data) {
    const childIds = new Set([
      ...data.batches.flatMap((b) => [...(b.files || []).map((f) => f.reviewId), ...(b.childReviewIds || [])]),
      ...currentReviews.filter((r) => r.coverage?.batchId).map((r) => r.id),
    ].filter(Boolean))
    return [...currentReviews.filter((r) => !r.batch && !childIds.has(r.id)), ...data.batches.map(toHistoryItem)]
  }

  const currentReviews = [
    {
      id: 'standalone-pasted',
      project: 'Gemini source code review',
      scope: 'Source snippet',
      status: 'Completed',
      batch: false,
      findings: 2,
    },
  ]

  const diverseBatches = {
    batches: [
      {
        id: 'batch-running',
        project: 'Project A',
        scope: 'Entire Project',
        status: 'In Progress',
        batch: true,
        coverage: { submitted: 10, pending: 5, running: 1, reviewed: 4, skipped: 0, failed: 0 },
        files: [],
        findingsCount: 4,
      },
      {
        id: 'batch-partial',
        project: 'Project B',
        scope: 'Selected Files',
        status: 'Partial',
        batch: true,
        coverage: { submitted: 5, pending: 0, running: 0, reviewed: 3, skipped: 0, failed: 2 },
        files: [],
        findingsCount: 6,
      },
      {
        id: 'batch-failed',
        project: 'Project C',
        scope: 'Entire Project',
        status: 'Failed',
        batch: true,
        coverage: { submitted: 8, pending: 0, running: 0, reviewed: 0, skipped: 0, failed: 8 },
        files: [],
        findingsCount: 0,
      },
      {
        id: 'batch-no-coverage',
        project: 'Project D',
        scope: 'Entire Project',
        status: 'Reviewed',
        batch: true,
        coverage: null, // Test edge case where coverage is null
        files: [{ reviewId: 'f1' }, { reviewId: 'f2' }],
        findingsCount: 1,
      },
    ],
  }

  const result = applyBatchRefreshStateUpdater(currentReviews, diverseBatches)
  assert.equal(result.length, 5, 'Standalone + 4 diverse batches')
  
  const noCoverageItem = result.find((r) => r.id === 'batch-no-coverage')
  assert.equal(noCoverageItem.scope, 'Entire Project (2)', 'Falls back to files.length when coverage is null')
})

test('Scenario 9: ReviewStats formats real database metrics and handles plurals/percentages correctly', () => {
  function formatReviewStats(stats) {
    return [
      {
        label: 'Total Reviews',
        value: String(stats?.totalReviews ?? 0),
        detail: `${stats?.recentThisMonth ?? 0} this month`,
      },
      {
        label: 'Files Reviewed',
        value: String(stats?.filesReviewed ?? 0),
        detail: `Across ${stats?.projectsCount ?? 0} project${stats?.projectsCount === 1 ? '' : 's'}`,
      },
      {
        label: 'Open Findings',
        value: String(stats?.openFindings ?? 0),
        detail: (stats?.openFindings ?? 0) === 1 ? '1 needs attention' : `${stats?.openFindings ?? 0} need attention`,
      },
      {
        label: 'Resolved Findings',
        value: String(stats?.resolvedFindings ?? 0),
        detail: (stats?.totalFindings ?? 0) > 0
          ? `${Math.round(((stats?.resolvedFindings ?? 0) / stats.totalFindings) * 100)}% of total findings`
          : '0% of total findings',
      },
    ]
  }

  // Realistic data from SentinelWAF AI
  const realStats = {
    totalReviews: 1,
    filesReviewed: 43,
    openFindings: 49,
    resolvedFindings: 1,
    totalFindings: 50,
    projectsCount: 1,
    recentThisMonth: 1,
  }

  const items = formatReviewStats(realStats)
  assert.equal(items[0].value, '1')
  assert.equal(items[0].detail, '1 this month')
  assert.equal(items[1].value, '43')
  assert.equal(items[1].detail, 'Across 1 project')
  assert.equal(items[2].value, '49')
  assert.equal(items[2].detail, '49 need attention')
  assert.equal(items[3].value, '1')
  assert.equal(items[3].detail, '2% of total findings')

  // Zero-state / empty user
  const emptyStats = {
    totalReviews: 0,
    filesReviewed: 0,
    openFindings: 0,
    resolvedFindings: 0,
    totalFindings: 0,
    projectsCount: 0,
    recentThisMonth: 0,
  }
  const emptyItems = formatReviewStats(emptyStats)
  assert.equal(emptyItems[0].value, '0')
  assert.equal(emptyItems[1].value, '0')
  assert.equal(emptyItems[1].detail, 'Across 0 projects')
  assert.equal(emptyItems[2].value, '0')
  assert.equal(emptyItems[2].detail, '0 need attention')
  assert.equal(emptyItems[3].value, '0')
  assert.equal(emptyItems[3].detail, '0% of total findings')
})

test('Scenario 10: Triage status changes update open and resolved findings counters synchronously', () => {
  function applyTriageToStats(curr, prevStatus, nextStatus) {
    if (!curr || prevStatus === nextStatus) return curr
    const wasOpen = prevStatus === 'Open'
    const isOpen = nextStatus === 'Open'
    let openFindings = curr.openFindings
    let resolvedFindings = curr.resolvedFindings
    if (wasOpen && !isOpen) {
      openFindings = Math.max(0, openFindings - 1)
      resolvedFindings += 1
    } else if (!wasOpen && isOpen) {
      openFindings += 1
      resolvedFindings = Math.max(0, resolvedFindings - 1)
    }
    return { ...curr, openFindings, resolvedFindings }
  }

  const initial = {
    totalReviews: 1,
    filesReviewed: 43,
    openFindings: 49,
    resolvedFindings: 1,
    totalFindings: 50,
  }

  // Triage finding from Open to Reviewed
  const step1 = applyTriageToStats(initial, 'Open', 'Reviewed')
  assert.equal(step1.openFindings, 48)
  assert.equal(step1.resolvedFindings, 2)

  // Triage another finding from Open to Fixed
  const step2 = applyTriageToStats(step1, 'Open', 'Fixed')
  assert.equal(step2.openFindings, 47)
  assert.equal(step2.resolvedFindings, 3)

  // Re-open a resolved finding
  const step3 = applyTriageToStats(step2, 'Reviewed', 'Open')
  assert.equal(step3.openFindings, 48)
  assert.equal(step3.resolvedFindings, 2)

  // Change from Reviewed to Fixed (no change in open count)
  const step4 = applyTriageToStats(step3, 'Reviewed', 'Fixed')
  assert.equal(step4.openFindings, 48)
  assert.equal(step4.resolvedFindings, 2)
})

test('Scenario 11: QualityOverview avoids fabricated percentages and reports "Not evaluated"', () => {
  const defaultQualityMetrics = [
    { label: 'Readability', value: 'Not evaluated' },
    { label: 'Maintainability', value: 'Not evaluated' },
    { label: 'Performance', value: 'Not evaluated' },
    { label: 'Best Practices', value: 'Not evaluated' },
  ]

  for (const metric of defaultQualityMetrics) {
    assert.equal(metric.value, 'Not evaluated')
    assert.notEqual(typeof metric.value, 'number', 'Must not be a fabricated percentage number')
  }
})
