import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isSafeUrl,
  splitTableRow,
  isTableSeparator,
  getTableAlignments,
  tokenizeInline,
  normalizeMarkdownHeadings,
  parseMarkdownBlocks,
} from '../src/utils/markdownParser.js'

// ---------------------------------------------------------------------------
// 1. URL Safety & XSS Neutralization Tests
// ---------------------------------------------------------------------------
test('isSafeUrl allows valid HTTPS, HTTP, and internal anchor URLs', () => {
  assert.equal(isSafeUrl('https://devnexus.ai'), true)
  assert.equal(isSafeUrl('https://github.com/project/repo'), true)
  assert.equal(isSafeUrl('http://localhost:5001/api/health'), true)
  assert.equal(isSafeUrl('#section-citations'), true)
})

test('isSafeUrl rejects malicious executable URI schemes', () => {
  assert.equal(isSafeUrl('javascript:alert(1)'), false)
  assert.equal(isSafeUrl('JAVASCRIPT:alert("xss")'), false)
  assert.equal(isSafeUrl('javascript:/*--></title></style>alert(1)'), false)
  assert.equal(isSafeUrl('data:text/html,<script>alert(1)</script>'), false)
  assert.equal(isSafeUrl('vbscript:msgbox("test")'), false)
  assert.equal(isSafeUrl('file:///etc/passwd'), false)
  assert.equal(isSafeUrl(null), false)
  assert.equal(isSafeUrl(undefined), false)
  assert.equal(isSafeUrl(''), false)
})

// ---------------------------------------------------------------------------
// 2. Table Parsing & Alignment Helpers
// ---------------------------------------------------------------------------
test('splitTableRow trims and splits table row cells cleanly', () => {
  assert.deepEqual(splitTableRow('| Function | Parameters | Return Type |'), [
    'Function',
    'Parameters',
    'Return Type',
  ])
  assert.deepEqual(splitTableRow('Function | Parameters | Return Type'), [
    'Function',
    'Parameters',
    'Return Type',
  ])
  assert.deepEqual(splitTableRow(''), [])
})

test('isTableSeparator identifies valid markdown separator rows', () => {
  assert.equal(isTableSeparator('| --- | --- | --- |'), true)
  assert.equal(isTableSeparator('| :--- | :---: | ---: |'), true)
  assert.equal(isTableSeparator(':---|---|:---:'), true)
  assert.equal(isTableSeparator('| Function | Parameters |'), false)
  assert.equal(isTableSeparator('Some plain text row'), false)
})

test('getTableAlignments extracts column text alignments', () => {
  const alignments = getTableAlignments('| :--- | :---: | ---: | --- |')
  assert.deepEqual(alignments, ['left', 'center', 'right', 'left'])
})

// ---------------------------------------------------------------------------
// 3. Inline Tokenizer Tests
// ---------------------------------------------------------------------------
test('tokenizeInline tokenizes code, bold, italic, and citations', () => {
  const text = 'Evaluate `add(a, b)` [S1] with **bold text** and *italic style*.'
  const tokens = tokenizeInline(text)

  assert.equal(tokens[0].type, 'text')
  assert.equal(tokens[0].value, 'Evaluate ')

  assert.equal(tokens[1].type, 'code')
  assert.equal(tokens[1].value, 'add(a, b)')

  assert.equal(tokens[2].type, 'text')
  assert.equal(tokens[2].value, ' ')

  assert.equal(tokens[3].type, 'citation')
  assert.equal(tokens[3].citationId, 'S1')

  const boldToken = tokens.find((t) => t.type === 'bold')
  assert.ok(boldToken)
  assert.equal(boldToken.value, 'bold text')

  const italicToken = tokens.find((t) => t.type === 'italic')
  assert.ok(italicToken)
  assert.equal(italicToken.value, 'italic style')
})

test('tokenizeInline parses nested formatting within bold tokens', () => {
  const text = '**Analysis of `add(a, b)` [S1]**'
  const tokens = tokenizeInline(text)

  assert.equal(tokens.length, 1)
  assert.equal(tokens[0].type, 'bold')
  assert.equal(tokens[0].children[0].value, 'Analysis of ')
  assert.equal(tokens[0].children[1].type, 'code')
  assert.equal(tokens[0].children[1].value, 'add(a, b)')
  assert.equal(tokens[0].children[3].type, 'citation')
  assert.equal(tokens[0].children[3].citationId, 'S1')
})

test('tokenizeInline neutralizes malicious javascript: links to plain text', () => {
  const text = 'Click [Security Test](javascript:alert(1)) here.'
  const tokens = tokenizeInline(text)

  // Unsafe link must not emit type: 'link'
  const linkToken = tokens.find((t) => t.type === 'link')
  assert.equal(linkToken, undefined, 'Must not produce an active link token')

  // Must emit fallback plain text
  const textTokens = tokens.filter((t) => t.type === 'text')
  assert.ok(textTokens.some((t) => t.value === 'Security Test'))
})

test('tokenizeInline permits safe https links', () => {
  const text = 'See [DevNexus Platform](https://devnexus.ai/docs).'
  const tokens = tokenizeInline(text)

  const linkToken = tokens.find((t) => t.type === 'link')
  assert.ok(linkToken)
  assert.equal(linkToken.text, 'DevNexus Platform')
  assert.equal(linkToken.url, 'https://devnexus.ai/docs')
})

test('tokenizeInline preserves raw HTML strings as harmless text tokens', () => {
  const text = '<script>window.location="http://evil.com"</script>'
  const tokens = tokenizeInline(text)

  assert.equal(tokens.length, 1)
  assert.equal(tokens[0].type, 'text')
  assert.equal(tokens[0].value, text)
})

// ---------------------------------------------------------------------------
// 4. Block Markdown Parser Tests
// ---------------------------------------------------------------------------
test('parseMarkdownBlocks parses headings from level 1 to level 6', () => {
  const md = [
    '# Primary Architecture',
    '## Core Modules',
    '### Mathematics Utilities',
    '#### Function Signatures',
    '##### Micro Specification',
    '###### Implementation Details',
  ].join('\n\n')

  const blocks = parseMarkdownBlocks(md)
  assert.equal(blocks.length, 6)

  assert.deepEqual(blocks[0], { type: 'heading', level: 1, text: 'Primary Architecture' })
  assert.deepEqual(blocks[1], { type: 'heading', level: 2, text: 'Core Modules' })
  assert.deepEqual(blocks[2], { type: 'heading', level: 3, text: 'Mathematics Utilities' })
  assert.deepEqual(blocks[3], { type: 'heading', level: 4, text: 'Function Signatures' })
  assert.deepEqual(blocks[4], { type: 'heading', level: 5, text: 'Micro Specification' })
  assert.deepEqual(blocks[5], { type: 'heading', level: 6, text: 'Implementation Details' })
})

test('parseMarkdownBlocks parses fenced code blocks with language tag', () => {
  const md = '```javascript\nfunction add(a, b) {\n  return a + b;\n}\n```'
  const blocks = parseMarkdownBlocks(md)

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'code')
  assert.equal(blocks[0].language, 'javascript')
  assert.equal(blocks[0].content, 'function add(a, b) {\n  return a + b;\n}')
})

test('parseMarkdownBlocks parses markdown tables with headers, alignments, and rows', () => {
  const md = [
    '| Function | Parameters | Return Type | Description |',
    '| :--- | :---: | ---: | --- |',
    '| `add` | `(a, b)` | `number` | Returns arithmetic sum [S1] |',
    '| `multiply` | `(a, b)` | `number` | Returns arithmetic product [S1] |',
  ].join('\n')

  const blocks = parseMarkdownBlocks(md)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'table')
  assert.deepEqual(blocks[0].headers, ['Function', 'Parameters', 'Return Type', 'Description'])
  assert.deepEqual(blocks[0].alignments, ['left', 'center', 'right', 'left'])
  assert.equal(blocks[0].rows.length, 2)
  assert.deepEqual(blocks[0].rows[0], ['`add`', '`(a, b)`', '`number`', 'Returns arithmetic sum [S1]'])
  assert.deepEqual(blocks[0].rows[1], ['`multiply`', '`(a, b)`', '`number`', 'Returns arithmetic product [S1]'])
})

test('parseMarkdownBlocks parses unordered and ordered lists with indentation', () => {
  const md = [
    '- Purpose: arithmetic operations [S1]',
    '- Parameters: accepts numbers a and b',
    '  - Sub-detail: handles integers and floats',
    '',
    '1. Inspect imports',
    '2. Execute calculation',
  ].join('\n')

  const blocks = parseMarkdownBlocks(md)
  assert.equal(blocks.length, 2)

  assert.equal(blocks[0].type, 'ul')
  assert.equal(blocks[0].items.length, 3)
  assert.equal(blocks[0].items[0].text, 'Purpose: arithmetic operations [S1]')
  assert.equal(blocks[0].items[2].indent, 2)

  assert.equal(blocks[1].type, 'ol')
  assert.equal(blocks[1].items.length, 2)
  assert.equal(blocks[1].items[0].text, 'Inspect imports')
  assert.equal(blocks[1].items[1].text, 'Execute calculation')
})

test('parseMarkdownBlocks parses blockquotes and horizontal rules', () => {
  const md = [
    '> This is an important security notice regarding input validation.',
    '',
    '---',
    '',
    'Follow up notes below.',
  ].join('\n')

  const blocks = parseMarkdownBlocks(md)
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0].type, 'blockquote')
  assert.equal(blocks[0].text, 'This is an important security notice regarding input validation.')
  assert.equal(blocks[1].type, 'hr')
  assert.equal(blocks[2].type, 'paragraph')
})

test('parseMarkdownBlocks handles complete realistic AI grounded response', () => {
  const fullResponse = [
    '### Purpose',
    'The `utils.js` module provides core mathematical helper functions [S1].',
    '',
    '### Functions Overview',
    '- `add(a, b)`: Computes the sum of `a` and `b` [S1].',
    '- `multiply(a, b)`: Computes the product of `a` and `b` [S1].',
    '',
    '| Function | Parameters | Complexity |',
    '| :--- | :--- | :--- |',
    '| `add` | `(a, b)` | O(1) |',
    '| `multiply` | `(a, b)` | O(1) |',
    '',
    '### Example Usage',
    '```javascript',
    'const { add, multiply } = require("./utils");',
    'console.log(add(10, 5)); // 15',
    '```',
  ].join('\n')

  const blocks = parseMarkdownBlocks(fullResponse)
  assert.equal(blocks.length, 7)
  assert.equal(blocks[0].type, 'heading')
  assert.equal(blocks[1].type, 'paragraph')
  assert.equal(blocks[2].type, 'heading')
  assert.equal(blocks[3].type, 'ul')
  assert.equal(blocks[4].type, 'table')
  assert.equal(blocks[5].type, 'heading')
  assert.equal(blocks[6].type, 'code')
})

test('parseMarkdownBlocks handles empty and edge inputs gracefully', () => {
  assert.deepEqual(parseMarkdownBlocks(null), [])
  assert.deepEqual(parseMarkdownBlocks(undefined), [])
  assert.deepEqual(parseMarkdownBlocks(''), [])
  assert.deepEqual(parseMarkdownBlocks('   \n\n   '), [])
})

// ---------------------------------------------------------------------------
// 5. Heading Normalization & Embedded Heading Recognition Tests
// ---------------------------------------------------------------------------
test('normalizeMarkdownHeadings separates headings embedded in continuous paragraph', () => {
  const input =
    'The module provides two utility functions. ### add(a, b)\n' +
    'This function evaluates a + b and returns their sum [S1]. ### multiply(a, b)\n' +
    'This function evaluates a * b and returns their product [S1].'

  const normalized = normalizeMarkdownHeadings(input)
  assert.ok(normalized.includes('\n\n### add(a, b)'), 'Expected blank line before add')
  assert.ok(normalized.includes('\n\n### multiply(a, b)'), 'Expected blank line before multiply')
})

test('normalizeMarkdownHeadings separates multiple function headings without newlines', () => {
  const input =
    'Overview of mathematics module. ### add(a, b) The add function evaluates a + b [S1]. ' +
    '### multiply(a, b) The multiply function evaluates a * b [S1].'

  const normalized = normalizeMarkdownHeadings(input)
  assert.ok(normalized.includes('\n\n### add(a, b)'))
  assert.ok(normalized.includes('\n\n### multiply(a, b)'))
  assert.ok(normalized.includes('\n\nThe add function'))
  assert.ok(normalized.includes('\n\nThe multiply function'))
})

test('normalizeMarkdownHeadings splits heading from trailing bullet point or colon on same line', () => {
  const input = '### add(a, b) - Purpose: Computes arithmetic sum [S1].'
  const normalized = normalizeMarkdownHeadings(input)

  assert.ok(normalized.includes('### add(a, b)\n\n- Purpose: Computes arithmetic sum [S1].'))
})

test('normalizeMarkdownHeadings strictly preserves comments inside fenced code blocks', () => {
  const input =
    'Here is the python script:\n' +
    '```python\n' +
    '### DB Configuration\n' +
    'def connect():\n' +
    '    ### Return client\n' +
    '    return None\n' +
    '```\n' +
    'Follow up notes: ### add(a, b)\n' +
    'Adds two numbers.'

  const normalized = normalizeMarkdownHeadings(input)

  // Code block comments must NOT be modified
  assert.ok(normalized.includes('### DB Configuration\ndef connect():\n    ### Return client'))
  // Heading outside code block MUST be normalized
  assert.ok(normalized.includes('Follow up notes:\n\n### add(a, b)'))
})

test('normalizeMarkdownHeadings strictly preserves inline backticked hashes', () => {
  const input = 'The hash delimiter is `### not a heading`. ### add(a, b)\nFunction body.'
  const normalized = normalizeMarkdownHeadings(input)

  assert.ok(normalized.includes('`### not a heading`'))
  assert.ok(normalized.includes('\n\n### add(a, b)'))
})

test('normalizeMarkdownHeadings preserves legitimate text hashes (C#, Issue #123, #1a2340)', () => {
  const input = 'Written in C# for issue #123 with primary color #1a2340. ### add(a, b)\nBody.'
  const normalized = normalizeMarkdownHeadings(input)

  assert.ok(normalized.includes('Written in C# for issue #123 with primary color #1a2340.'))
  assert.ok(normalized.includes('\n\n### add(a, b)'))
})

test('parseMarkdownBlocks produces distinct heading blocks from continuous paragraph containing ### add(a, b) and ### multiply(a, b)', () => {
  const input =
    'The module provides two utility functions. ### add(a, b)\n' +
    'The add function evaluates a + b and returns their sum [S1]. ### multiply(a, b)\n' +
    'The multiply function evaluates a * b and returns their product [S1].'

  const blocks = parseMarkdownBlocks(input)

  const headings = blocks.filter((b) => b.type === 'heading')
  assert.equal(headings.length, 2, 'Expected exactly 2 heading blocks')
  assert.equal(headings[0].level, 3)
  assert.equal(headings[0].text, 'add(a, b)')
  assert.equal(headings[1].level, 3)
  assert.equal(headings[1].text, 'multiply(a, b)')

  const paragraphs = blocks.filter((b) => b.type === 'paragraph')
  assert.equal(paragraphs.length, 3, 'Expected 3 paragraph blocks')
  assert.equal(paragraphs[0].text, 'The module provides two utility functions.')
  assert.ok(paragraphs[1].text.includes('returns their sum [S1]'))
  assert.ok(paragraphs[2].text.includes('returns their product [S1]'))
})

test('parseMarkdownBlocks preserves source citations [S1] within normalized headings and paragraphs', () => {
  const input =
    'Functions in utils.js: ### add(a, b) [S1]\n' +
    'Adds numbers [S1]. ### multiply(a, b) [S1]\n' +
    'Multiplies numbers [S1].'

  const blocks = parseMarkdownBlocks(input)
  const headings = blocks.filter((b) => b.type === 'heading')

  assert.equal(headings.length, 2)
  assert.ok(headings[0].text.includes('[S1]'), 'Heading 1 preserves citation')
  assert.ok(headings[1].text.includes('[S1]'), 'Heading 2 preserves citation')
})
