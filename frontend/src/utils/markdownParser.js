/**
 * Utility functions for parsing Markdown into structured AST blocks and inline tokens.
 * Pure JavaScript with zero external dependencies and strict security sanitization.
 */

/**
 * Validates whether a URL is safe for anchor hrefs.
 * Blocks javascript:, data:, vbscript:, and other executable URI schemes.
 */
export function isSafeUrl(url) {
  if (!url || typeof url !== 'string') return false
  const trimmed = url.trim().toLowerCase()
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('vbscript:') ||
    trimmed.startsWith('file:')
  ) {
    return false
  }
  return trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('#')
}

/**
 * Splits a markdown table row by pipe delimiter into trimmed cell strings.
 */
export function splitTableRow(rowStr) {
  if (!rowStr || typeof rowStr !== 'string') return []
  let raw = rowStr.trim()
  if (raw.startsWith('|')) raw = raw.slice(1)
  if (raw.endsWith('|')) raw = raw.slice(0, -1)
  return raw.split('|').map((col) => col.trim())
}

/**
 * Checks if a string is a markdown table separator row (e.g. |:---|:---:|---:|).
 */
export function isTableSeparator(line) {
  if (!line || typeof line !== 'string') return false
  const trimmed = line.trim()
  if (!trimmed.includes('|') && !trimmed.includes('-')) return false
  const cells = splitTableRow(trimmed)
  if (cells.length === 0) return false
  return cells.every((cell) => /^:?-+:?$/.test(cell))
}

/**
 * Extracts alignment directives ('left', 'center', 'right') from table separator cells.
 */
export function getTableAlignments(separatorLine) {
  const cells = splitTableRow(separatorLine)
  return cells.map((cell) => {
    if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
    if (cell.endsWith(':')) return 'right'
    return 'left'
  })
}

/**
 * Determines whether a line indicates the start of a new Markdown block element.
 */
function isBlockBoundary(line, nextLine) {
  if (!line || typeof line !== 'string') return false
  const trimmed = line.trim()
  if (trimmed.startsWith('```')) return true
  if (/^#{1,6}\s+/.test(trimmed)) return true
  if (/^\s*(\*{3,}|-{3,}|_{3,})\s*$/.test(trimmed)) return true
  if (/^\s*>\s?/.test(trimmed)) return true
  if (/^\s*[-*+]\s+/.test(trimmed)) return true
  if (/^\s*\d+\.\s+/.test(trimmed)) return true
  if (trimmed.includes('|') && nextLine && isTableSeparator(nextLine)) return true
  return false
}

/**
 * Tokenizes inline text into structured formatting tokens:
 * - text: plain text
 * - code: inline code (`foo`)
 * - citation: source citations ([S1], [S2])
 * - link: safe hyperlinks ([text](url))
 * - bold_italic: bold and italic (***text*** or ___text___)
 * - bold: bold text (**text** or __text__)
 * - italic: italic text (*text* or _text_)
 */
export function tokenizeInline(text) {
  if (!text || typeof text !== 'string') return []

  const tokens = []
  // Matches inline code, citations [S1], markdown links [text](url), bold italic, bold, italic
  const inlineRegex =
    /(`[^`]+`|\[S\d+\]|\[[^\]]+\]\([^\s)]+\)|\*\*\*[^*]+?\*\*\*|___[^_]+?___|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*]+?\*|_[^_]+?_)/g

  let lastIndex = 0
  let match

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        value: text.substring(lastIndex, match.index),
      })
    }

    const raw = match[0]

    if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push({
        type: 'code',
        value: raw.slice(1, -1),
      })
    } else if (/^\[S\d+\]$/.test(raw)) {
      tokens.push({
        type: 'citation',
        citationId: raw.slice(1, -1),
        raw,
      })
    } else if (raw.startsWith('[') && raw.includes('](') && raw.endsWith(')')) {
      const linkMatch = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (linkMatch && isSafeUrl(linkMatch[2])) {
        tokens.push({
          type: 'link',
          text: linkMatch[1],
          url: linkMatch[2],
          children: tokenizeInline(linkMatch[1]),
        })
      } else {
        // Fallback to safe plain text for unsafe or malformed links
        tokens.push({
          type: 'text',
          value: linkMatch ? linkMatch[1] : raw,
        })
      }
    } else if (
      (raw.startsWith('***') && raw.endsWith('***')) ||
      (raw.startsWith('___') && raw.endsWith('___'))
    ) {
      const inner = raw.slice(3, -3)
      tokens.push({
        type: 'bold_italic',
        value: inner,
        children: tokenizeInline(inner),
      })
    } else if (
      (raw.startsWith('**') && raw.endsWith('**')) ||
      (raw.startsWith('__') && raw.endsWith('__'))
    ) {
      const inner = raw.slice(2, -2)
      tokens.push({
        type: 'bold',
        value: inner,
        children: tokenizeInline(inner),
      })
    } else if (
      (raw.startsWith('*') && raw.endsWith('*')) ||
      (raw.startsWith('_') && raw.endsWith('_'))
    ) {
      const inner = raw.slice(1, -1)
      tokens.push({
        type: 'italic',
        value: inner,
        children: tokenizeInline(inner),
      })
    } else {
      tokens.push({
        type: 'text',
        value: raw,
      })
    }

    lastIndex = inlineRegex.lastIndex
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      value: text.substring(lastIndex),
    })
  }

  return tokens
}

/**
 * Normalizes Markdown headings that may have been generated inline inside a continuous paragraph
 * or without preceding blank lines (e.g. in legacy saved conversations or models generating
 * "sentence. ### add(a, b)\n...").
 *
 * Strictly preserves fenced code blocks, inline code, and legitimate inline hashes (e.g. C#, #123).
 */
export function normalizeMarkdownHeadings(content) {
  if (!content || typeof content !== 'string') return ''

  // Step 1: Protect fenced code blocks (``` ... ```)
  const codeBlocks = []
  const noCodeBlocks = content.replace(/(```[a-zA-Z0-9_-]*\r?\n?[\s\S]*?```)/g, (match) => {
    const idx = codeBlocks.length
    codeBlocks.push(match)
    return `@@@DEVNEXUS_CODE_BLOCK_${idx}@@@`
  })

  // Step 2: Protect inline code (`...`)
  const inlineCodes = []
  const noInlineCode = noCodeBlocks.replace(/(`[^`\n]+`)/g, (match) => {
    const idx = inlineCodes.length
    inlineCodes.push(match)
    return `@@@DEVNEXUS_INLINE_CODE_${idx}@@@`
  })

  // Step 3: Insert line breaks before headings embedded inside paragraph text.
  // Matches any non-whitespace, non-newline character followed by space and #{1,6}\s+
  // Positive lookahead ensures the heading title begins with a word, identifier, backtick, or symbol.
  let normalized = noInlineCode.replace(
    /([^\n\r\s])\s+(#{1,6}\s+(?=[A-Za-z0-9_./`*(]))/g,
    '$1\n\n$2'
  )

  // Step 4: Handle headings followed on the same line by body text or list items.
  // 4a. Heading followed by bullet point: "### add(a, b) - Purpose: Computes sum [S1]."
  normalized = normalized.replace(
    /^(\s*#{1,6}\s+[A-Za-z0-9_./-]+\([^)]*\))\s+([*+-]\s+.*)$/gm,
    '$1\n\n$2'
  )
  // 4b. Heading followed by body text / colon: "### add(a, b): The function..." or "### add(a, b) The function..."
  normalized = normalized.replace(
    /^(\s*#{1,6}\s+[A-Za-z0-9_./-]+\([^)]*\))(?:\s*[:—]\s*|\s+)([A-Z].*)$/gm,
    '$1\n\n$2'
  )

  // Step 5: Restore inline codes
  let restored = normalized.replace(/@@@DEVNEXUS_INLINE_CODE_(\d+)@@@/g, (_, idx) => {
    return inlineCodes[Number(idx)] || ''
  })

  // Step 6: Restore fenced code blocks
  restored = restored.replace(/@@@DEVNEXUS_CODE_BLOCK_(\d+)@@@/g, (_, idx) => {
    return codeBlocks[Number(idx)] || ''
  })

  return restored
}

/**
 * Parses raw markdown text into a sequence of block objects:
 * - code: fenced code blocks with language and content
 * - heading: headings with level 1-6 and text
 * - table: tables with headers, alignments, and rows
 * - ul: unordered lists with items and indentation
 * - ol: ordered lists with items and indentation
 * - blockquote: quote blocks with text
 * - hr: horizontal dividers
 * - paragraph: body paragraphs with text
 */
export function parseMarkdownBlocks(content) {
  if (!content || typeof content !== 'string') return []

  const preprocessed = normalizeMarkdownHeadings(content)
  const normalized = preprocessed.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const blocks = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()

    // 1. Empty lines
    if (trimmed === '') {
      i++
      continue
    }

    // 2. Fenced code block
    if (trimmed.startsWith('```')) {
      const langMatch = trimmed.match(/^```([a-zA-Z0-9_-]+)?/)
      const language = langMatch && langMatch[1] ? langMatch[1] : 'plaintext'
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++ // Consume closing ```
      }
      blocks.push({
        type: 'code',
        language,
        content: codeLines.join('\n'),
      })
      continue
    }

    // 3. Table
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(lines[i])
      const alignments = getTableAlignments(lines[i + 1])
      const rows = []
      i += 2 // Skip header and separator

      while (
        i < lines.length &&
        lines[i].trim().includes('|') &&
        !lines[i].trim().startsWith('```')
      ) {
        rows.push(splitTableRow(lines[i]))
        i++
      }

      blocks.push({
        type: 'table',
        headers,
        alignments,
        rows,
      })
      continue
    }

    // 4. Headings (# to ######)
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      })
      i++
      continue
    }

    // 5. Horizontal rule
    if (/^\s*(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // 6. Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({
        type: 'blockquote',
        text: quoteLines.join('\n'),
      })
      continue
    }

    // 7. Unordered list (- * +)
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const itemMatch = lines[i].match(/^(\s*)[-*+]\s+(.*)$/)
        items.push({
          indent: itemMatch[1].length,
          text: itemMatch[2],
        })
        i++
      }
      blocks.push({
        type: 'ul',
        items,
      })
      continue
    }

    // 8. Ordered list (1. 2.)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemMatch = lines[i].match(/^(\s*)\d+\.\s+(.*)$/)
        items.push({
          indent: itemMatch[1].length,
          text: itemMatch[2],
        })
        i++
      }
      blocks.push({
        type: 'ol',
        items,
      })
      continue
    }

    // 9. Standard paragraph
    const pLines = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isBlockBoundary(lines[i], lines[i + 1])
    ) {
      pLines.push(lines[i])
      i++
    }
    blocks.push({
      type: 'paragraph',
      text: pLines.join('\n'),
    })
  }

  return blocks
}
