const { sourceError } = require('./sourceArchive')

const REVIEW_SCOPES = Object.freeze({ selected: 'Selected Files', project: 'Entire Project' })
const REVIEW_SCOPE_VALUES = Object.freeze(Object.values(REVIEW_SCOPES))
const REVIEW_SCOPE_LIMITS = Object.freeze({
  [REVIEW_SCOPES.selected]: Object.freeze({ minFiles: 1, maxFiles: 3, maxOrdinal: 2 }),
  [REVIEW_SCOPES.project]: Object.freeze({ minFiles: 1, maxFiles: 200, maxOrdinal: 199 }),
})
function parseReviewScope(value) {
  const scope = value === undefined ? REVIEW_SCOPES.selected : value
  if (!REVIEW_SCOPE_VALUES.includes(scope)) throw sourceError('invalid_review_scope', 'Unsupported review scope.')
  return scope
}
module.exports = { REVIEW_SCOPES, REVIEW_SCOPE_VALUES, REVIEW_SCOPE_LIMITS, parseReviewScope }
