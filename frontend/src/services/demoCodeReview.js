export const codeSamples = [
  { id: 'security', name: 'JavaScript · unsafe request handler', file: 'requestHandler.js', code: `export function handleRequest(req, res) {
  const result = eval(req.query.expression)
  document.getElementById('result').innerHTML = req.query.message
  console.log(req.body)
  if (result == null) {
    return res.status(400).json({ error: 'Missing result' })
  }
  return res.json({ result })
}` },
  { id: 'quality', name: 'JavaScript · legacy calculation', file: 'calculateTotal.js', code: `export function calculateTotal(items) {
  var total = 0
  for (const item of items) {
    total += item.price
  }
  console.log(total)
  if (total == 0) return 'Empty'
  return total
}` },
  { id: 'clean', name: 'JavaScript · improved calculation', file: 'calculateTotal.js', code: `export function calculateTotal(items) {
  if (!Array.isArray(items)) {
    throw new TypeError('Expected an array of items')
  }
  return items.reduce((total, item) => {
    if (!Number.isFinite(item.price)) {
      throw new TypeError('Expected a finite price')
    }
    return total + item.price
  }, 0)
}` },
]

export const demoSeverities = ['Critical', 'High', 'Medium', 'Low', 'Info']

// Limited text rules for a repeatable offline demonstration, not an AI or AST analysis.
const rules = [
  { pattern: /\beval\s*\(/, severity: 'Critical', category: 'Security', problem: 'Dynamic code execution with eval.', explanation: 'If this expression contains untrusted input, it can execute arbitrary JavaScript.', improvement: 'Replace eval with a restricted parser or an allowlist of supported operations.', fix: '// Parse supported operations explicitly; never execute input as code.' },
  { pattern: /\.innerHTML\s*=/, severity: 'High', category: 'Security', problem: 'Potential HTML injection.', explanation: 'Assigning untrusted content to innerHTML can introduce executable markup.', improvement: 'Use textContent for plain text. Sanitize with a trusted library if HTML is required.', fix: "element.textContent = message" },
  { pattern: /(^|\s)var\s+/, severity: 'Medium', category: 'Maintainability', problem: 'Function-scoped mutable declaration.', explanation: 'var is function-scoped and can make variable lifetime less obvious.', improvement: 'Use let for reassigned variables and const for values that do not change.', fix: null },
  { pattern: /(?<![=!])==(?!=)|(?<![!])!=(?!=)/, severity: 'Low', category: 'Potential Bug', problem: 'Implicit type coercion in comparison.', explanation: 'Loose equality can treat values of different types as equal. Check whether coercion is intentional.', improvement: 'Prefer strict equality after explicitly normalizing the input types.', fix: null },
  { pattern: /\bconsole\.log\s*\(/, severity: 'Info', category: 'Best Practice', problem: 'Debug output in application code.', explanation: 'Console output can expose request data or add unnecessary noise in production.', improvement: 'Remove debug output or use a logger with levels and redaction.', fix: '// Use a configured logger and redact sensitive fields.' },
]

export function analyzeDemoCode(code, file = 'pasted-source.js') {
  return code.split(/\r\n|\n|\r/).flatMap((text, index) => rules.filter((rule) => rule.pattern.test(text)).map((rule, ruleIndex) => ({
    id: `demo-${index + 1}-${ruleIndex}`, severity: rule.severity, category: rule.category,
    problem: rule.problem, explanation: rule.explanation, improvement: rule.improvement,
    status: 'Open', file, line: String(index + 1), code: text,
    suggestedCode: rule.fix || (rule.severity === 'Medium' ? text.replace(/\bvar\b/, 'let') : text.replace(/(?<![=!])==(?!=)/g, '===').replace(/(?<![!])!=(?!=)/g, '!==')),
  })))
}
