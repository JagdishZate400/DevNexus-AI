import { useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { analyzeDemoCode, codeSamples } from '../../services/demoCodeReview'
import { reviewsApi, isMockToken } from '../../services/api'
import { useAuthStore } from '../../store/authStore'

function DemoCodeInput({ onAnalyze }) {
  const [sampleId, setSampleId] = useState(codeSamples[0].id)
  const [code, setCode] = useState(codeSamples[0].code)
  const [analyzedCode, setAnalyzedCode] = useState(null)
  const [language, setLanguage] = useState('javascript')
  const [mode, setMode] = useState('backend')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const token = useAuthStore((state) => state.token)
  const sample = codeSamples.find((item) => item.id === sampleId)
  const tooLong = code.length > 50000

  async function analyze() {
    if (isLoading || !code.trim() || tooLong) return
    setIsLoading(true)
    setMessage('')
    setError('')
    const file = code === sample.code && language === 'javascript' ? sample.file : `pasted-source.${language === 'typescript' ? 'ts' : 'js'}`
    function demo(reason) {
      const findings = analyzeDemoCode(code, file)
      onAnalyze({ findings, provider: 'demo', file })
      setMessage(`Demo Data: ${reason} Local analysis completed with ${findings.length} findings.`)
      setAnalyzedCode(code)
    }
    try {
      if (mode === 'demo') {
        demo('Demo mode selected.')
      } else {
        if (isMockToken(token)) throw new Error('Sign in to use backend analysis, or select Demo mode.')
        const data = await reviewsApi.analyze(token, { code, language, file, ...(mode === 'deterministic' ? { mode } : {}) })
        if (!['deterministic', 'gemini'].includes(data?.provider) || !Array.isArray(data?.findings) || data.findings.some((finding) => !finding || typeof finding !== 'object' || Array.isArray(finding))) throw new Error('Unexpected analysis response. Try again or select Demo mode.')
        onAnalyze(data)
        setAnalyzedCode(code)
        setMessage(`Backend analysis completed with ${data.findings.length} findings.${data.truncated ? ` Showing the first 200 of ${data.total}.` : ''} ${data.provider === 'gemini' ? 'Gemini AI source review.' : 'Deterministic text checks; no AI service used.'}`)
      }
    } catch (err) {
      setError(err.data?.errors?.[0]?.message || err.message || 'Analysis failed. Try again.')
    } finally {
      setIsLoading(false)
    }
  }
  return <section className="my-7 rounded-xl border border-[#2b3558] bg-[#121a2e] p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold text-[#eef1f8]">Try a source code review</h2><span className="rounded-full bg-[#f59e0b]/15 px-3 py-1 text-xs font-bold text-[#fbbf24]">{message.startsWith('Demo Data:') || mode === 'demo' ? 'Demo Data' : mode === 'deterministic' ? 'Deterministic checks' : 'Backend analysis'}</span></div>
    <p className="mt-2 text-sm leading-6 text-[#8f99b0]">Backend mode uses the configured provider; Gemini sends submitted code to Google for AI review. Deterministic mode uses text checks on the server. Demo mode runs locally. Code is never executed. Review results can miss issues or flag intentional code.</p>
    <div className="mt-4 flex flex-wrap gap-4"><label className="text-xs font-bold text-[#b9c2d6]">Analysis mode<select aria-label="Analysis mode" disabled={isLoading} value={mode} onChange={(event) => { setMode(event.target.value); setMessage(''); setError('') }} className="ml-2 rounded-lg border border-[#2b3558] bg-[#0e1428] px-3 py-2 text-sm"><option value="backend">Configured backend provider</option><option value="deterministic">Deterministic checks</option><option value="demo">Demo Data (local only)</option></select></label><label className="text-xs font-bold text-[#b9c2d6]">Language<select aria-label="Language" disabled={isLoading} value={language} onChange={(event) => { setLanguage(event.target.value); setMessage(''); setError(''); setAnalyzedCode(null) }} className="ml-2 rounded-lg border border-[#2b3558] bg-[#0e1428] px-3 py-2 text-sm"><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option></select></label></div>
    <div className="mt-4 flex flex-wrap items-end gap-3"><label className="flex-1 text-xs font-bold text-[#b9c2d6]">Sample source code<select disabled={isLoading} aria-label="Sample source code" value={sampleId} onChange={(event) => { const next = codeSamples.find((item) => item.id === event.target.value); setSampleId(next.id); setCode(next.code); setLanguage('javascript'); setMessage(''); setError('') }} className="mt-2 block w-full rounded-lg border border-[#2b3558] bg-[#0e1428] px-3 py-2.5 text-sm text-[#b9c2d6]">{codeSamples.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" disabled={isLoading} onClick={() => { setCode(sample.code); setMessage(''); setError('') }} className="inline-flex items-center gap-2 rounded-lg border border-[#2b3558] px-3 py-2.5 text-sm text-[#b9c2d6]"><RotateCcw size={15} /> Reset sample</button></div>
    <label className="mt-4 block text-xs font-bold text-[#b9c2d6]">Source code<textarea disabled={isLoading} aria-label="Source code" spellCheck={false} value={code} onChange={(event) => { setCode(event.target.value); setMessage(''); setError('') }} rows={12} className="mt-2 block w-full resize-y rounded-lg border border-[#2b3558] bg-[#0e1428] p-4 font-mono text-sm leading-6 text-[#cdd6e8] outline-none focus:border-[#f59e0b] focus:ring-2 focus:ring-[#f59e0b]/20" /></label>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs text-[#8f99b0]">{tooLong ? 'Use 50,000 characters or fewer.' : analyzedCode !== null && analyzedCode !== code ? 'Code changed. Analyze again to refresh the findings below.' : `${code.split(/\r\n|\n|\r/).length} lines - ${language} source`}</p><button type="button" disabled={isLoading || !code.trim() || tooLong} onClick={analyze} className="btn-press inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-5 py-3 text-sm font-bold text-[#231303] hover:bg-[#fbbf24] disabled:cursor-not-allowed disabled:opacity-40"><Play size={16} /> {isLoading ? 'Analyzing Code...' : 'Analyze Code'}</button></div>
    {isLoading ? <p role="status" className="mt-4 text-sm text-[#fbbf24]">Analyzing source on the backend...</p> : null}
    {message ? <p role="status" className="mt-4 text-sm text-[#34d399]">{message}</p> : null}
    {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
  </section>
}

export default DemoCodeInput
