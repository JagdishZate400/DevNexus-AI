import { useState, Fragment } from 'react'
import { Code2, Copy, Check } from 'lucide-react'
import { parseMarkdownBlocks, tokenizeInline } from '../../utils/markdownParser'

/**
 * Interactive CodeBlock component with copy-to-clipboard functionality.
 */
function CodeBlock({ language, content }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      // Gracefully ignore clipboard failures
    }
  }

  return (
    <div className="my-3 w-full overflow-hidden rounded-lg border border-[#232c4b] bg-[#0b1120] shadow-sm">
      <div className="flex items-center justify-between border-b border-[#232c4b] bg-[#121a2e] px-3.5 py-1.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#8f99b0]">
          <Code2 size={13} className="text-[#34d399]" />
          <span>{language || 'plaintext'}</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded bg-[#1a2340] px-2 py-0.5 text-xs text-[#8f99b0] hover:bg-[#232c4b] hover:text-[#eef1f8] transition-colors"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check size={12} className="text-[#34d399]" />
              <span className="text-[#34d399] font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs font-mono text-[#d5dbea] leading-relaxed">
        <code>{content}</code>
      </pre>
    </div>
  )
}

/**
 * Renders parsed inline tokens into secure React elements without raw HTML injection.
 */
function renderInlineTokens(tokens, options) {
  if (!tokens || tokens.length === 0) return null

  return tokens.map((token, idx) => {
    switch (token.type) {
      case 'code':
        return (
          <code
            key={idx}
            className={`rounded px-1.5 py-0.5 font-mono text-xs ${
              options.isUser
                ? 'bg-[#231303]/15 text-[#231303] font-semibold'
                : 'bg-[#0b1120] text-[#34d399] border border-[#232c4b]'
            }`}
          >
            {token.value}
          </code>
        )

      case 'citation': {
        const matchedSource = options.sources?.find((s) => {
          if (!s) return false
          if (typeof s === 'string') return s.includes(token.citationId)
          return s.citationId === token.citationId
        })

        if (matchedSource && options.onSourceClick) {
          return (
            <button
              type="button"
              key={idx}
              onClick={() => options.onSourceClick(matchedSource)}
              className="inline-flex items-center rounded bg-[#34d399]/20 px-1.5 py-0.2 mx-0.5 text-xs font-semibold text-[#34d399] border border-[#34d399]/40 hover:bg-[#34d399]/30 hover:border-[#34d399] transition-colors cursor-pointer align-baseline"
              title={`View cited source: ${matchedSource.path || token.citationId}`}
            >
              [{token.citationId}]
            </button>
          )
        }

        return (
          <span
            key={idx}
            className="inline-flex items-center rounded bg-[#34d399]/15 px-1.5 py-0.2 mx-0.5 text-xs font-medium text-[#34d399] border border-[#34d399]/30 align-baseline"
          >
            [{token.citationId}]
          </span>
        )
      }

      case 'link':
        return (
          <a
            key={idx}
            href={token.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline decoration-1 underline-offset-2 hover:opacity-80 transition-opacity ${
              options.isUser ? 'text-[#231303] font-semibold' : 'text-[#34d399]'
            }`}
          >
            {renderInlineTokens(token.children, options)}
          </a>
        )

      case 'bold':
        return (
          <strong
            key={idx}
            className={`font-semibold ${options.isUser ? 'text-[#231303]' : 'text-[#fbbf24]'}`}
          >
            {renderInlineTokens(token.children, options)}
          </strong>
        )

      case 'italic':
        return (
          <em
            key={idx}
            className={`italic ${options.isUser ? 'text-[#231303]' : 'text-[#d5dbea]'}`}
          >
            {renderInlineTokens(token.children, options)}
          </em>
        )

      case 'bold_italic':
        return (
          <strong
            key={idx}
            className={`font-semibold italic ${options.isUser ? 'text-[#231303]' : 'text-[#fbbf24]'}`}
          >
            {renderInlineTokens(token.children, options)}
          </strong>
        )

      case 'text':
      default:
        return <span key={idx}>{token.value}</span>
    }
  })
}

/**
 * Main MarkdownContent component for rendering structured assistant and user chat responses.
 */
function MarkdownContent({ content, sources = [], isUser = false, onSourceClick }) {
  if (!content || typeof content !== 'string') {
    return null
  }

  const blocks = parseMarkdownBlocks(content)
  const options = { sources, isUser, onSourceClick }

  return (
    <div className="space-y-2.5 break-words">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading': {
            const headingClasses = {
              1: isUser
                ? 'text-lg font-bold text-[#231303] mt-2 mb-1'
                : 'text-xl font-bold text-[#eef1f8] mt-3.5 mb-1.5 pb-1 border-b border-[#232c4b] first:mt-0',
              2: isUser
                ? 'text-base font-bold text-[#231303] mt-2 mb-1'
                : 'text-lg font-bold text-[#eef1f8] mt-3 mb-1.5 pb-1 border-b border-[#232c4b]/60 first:mt-0',
              3: isUser
                ? 'text-sm font-semibold text-[#231303] mt-1.5 mb-1'
                : 'text-base font-semibold text-[#fbbf24] mt-2.5 mb-1 first:mt-0',
              4: isUser
                ? 'text-sm font-semibold text-[#231303] mt-1 mb-0.5'
                : 'text-sm font-semibold text-[#34d399] mt-2 mb-1 first:mt-0',
              5: isUser
                ? 'text-xs font-semibold text-[#231303] uppercase mt-1'
                : 'text-xs font-semibold text-[#fbbf24] uppercase tracking-wider mt-1.5 mb-0.5 first:mt-0',
              6: isUser
                ? 'text-xs font-semibold text-[#231303] uppercase mt-1'
                : 'text-xs font-semibold text-[#8f99b0] uppercase tracking-wider mt-1.5 mb-0.5 first:mt-0',
            }

            const className = headingClasses[block.level] || headingClasses[3]
            const tokens = tokenizeInline(block.text)

            if (block.level === 1) return <h1 key={idx} className={className}>{renderInlineTokens(tokens, options)}</h1>
            if (block.level === 2) return <h2 key={idx} className={className}>{renderInlineTokens(tokens, options)}</h2>
            if (block.level === 3) return <h3 key={idx} className={className}>{renderInlineTokens(tokens, options)}</h3>
            if (block.level === 4) return <h4 key={idx} className={className}>{renderInlineTokens(tokens, options)}</h4>
            if (block.level === 5) return <h5 key={idx} className={className}>{renderInlineTokens(tokens, options)}</h5>
            return <h6 key={idx} className={className}>{renderInlineTokens(tokens, options)}</h6>
          }

          case 'table':
            return (
              <div
                key={idx}
                className="my-3 w-full overflow-x-auto rounded-lg border border-[#232c4b] bg-[#0b1120] shadow-sm"
              >
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-[#232c4b] bg-[#121a2e] text-[#8f99b0]">
                    <tr>
                      {block.headers.map((header, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-3.5 py-2.5 font-semibold text-[#eef1f8] tracking-wide"
                          style={{ textAlign: block.alignments[hIdx] || 'left' }}
                        >
                          {renderInlineTokens(tokenizeInline(header), options)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#232c4b]/50">
                    {block.rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="hover:bg-[#1a2340]/40 transition-colors"
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className="px-3.5 py-2 text-[#d5dbea]"
                            style={{ textAlign: block.alignments[cIdx] || 'left' }}
                          >
                            {renderInlineTokens(tokenizeInline(cell), options)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )

          case 'code':
            return (
              <CodeBlock
                key={idx}
                language={block.language}
                content={block.content}
              />
            )

          case 'ul':
            return (
              <ul
                key={idx}
                className={`my-2 ml-5 list-disc space-y-1 text-sm leading-relaxed ${
                  isUser ? 'marker:text-[#231303] text-[#231303]' : 'marker:text-[#34d399] text-[#eef1f8]'
                }`}
              >
                {block.items.map((item, itemIdx) => (
                  <li
                    key={itemIdx}
                    className="pl-1"
                    style={{ marginLeft: `${Math.min(item.indent * 0.5, 3)}rem` }}
                  >
                    {renderInlineTokens(tokenizeInline(item.text), options)}
                  </li>
                ))}
              </ul>
            )

          case 'ol':
            return (
              <ol
                key={idx}
                className={`my-2 ml-5 list-decimal space-y-1 text-sm leading-relaxed ${
                  isUser ? 'marker:text-[#231303] text-[#231303]' : 'marker:text-[#fbbf24] text-[#eef1f8]'
                }`}
              >
                {block.items.map((item, itemIdx) => (
                  <li
                    key={itemIdx}
                    className="pl-1"
                    style={{ marginLeft: `${Math.min(item.indent * 0.5, 3)}rem` }}
                  >
                    {renderInlineTokens(tokenizeInline(item.text), options)}
                  </li>
                ))}
              </ol>
            )

          case 'blockquote':
            return (
              <blockquote
                key={idx}
                className="my-2 border-l-2 border-[#34d399] bg-[#121a2e]/60 px-3 py-1.5 italic text-[#8f99b0] text-sm rounded-r"
              >
                {block.text.split('\n').map((line, lIdx) => (
                  <div key={lIdx}>
                    {renderInlineTokens(tokenizeInline(line), options)}
                  </div>
                ))}
              </blockquote>
            )

          case 'hr':
            return <hr key={idx} className="my-3 border-[#232c4b]" />

          case 'paragraph':
          default:
            return (
              <p
                key={idx}
                className={`my-2 first:mt-0 last:mb-0 text-sm leading-relaxed ${
                  isUser ? 'text-[#231303]' : 'text-[#eef1f8]'
                }`}
              >
                {block.text.split('\n').map((line, lIdx) => (
                  <Fragment key={lIdx}>
                    {lIdx > 0 && <br />}
                    {renderInlineTokens(tokenizeInline(line), options)}
                  </Fragment>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}

export default MarkdownContent
