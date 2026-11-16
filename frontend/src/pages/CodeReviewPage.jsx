import { Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import DemoCodeInput from '../components/codeReview/DemoCodeInput'
import { demoSeverities } from '../services/demoCodeReview'
import CodePreview from '../components/codeReview/CodePreview'
import FindingCard from '../components/codeReview/FindingCard'
import FindingsFilters from '../components/codeReview/FindingsFilters'
import QualityOverview from '../components/codeReview/QualityOverview'
import ReviewHistory from '../components/codeReview/ReviewHistory'
import ReviewStats from '../components/codeReview/ReviewStats'
import ReviewSummary from '../components/codeReview/ReviewSummary'
import BatchProgress from '../components/codeReview/BatchProgress'
import StartReviewModal from '../components/codeReview/StartReviewModal'
import { repositoryReviewsApi, repositoryReviewBatchesApi, isMockToken } from '../services/api'
import { useAuthStore } from '../store/authStore'

const defaultQualityMetrics = [
  { label: 'Readability', value: 'Not evaluated' },
  { label: 'Maintainability', value: 'Not evaluated' },
  { label: 'Performance', value: 'Not evaluated' },
  { label: 'Best Practices', value: 'Not evaluated' },
]

// History uses a numeric count; finding state always contains an array of records.
function asFindings(value) {
  return Array.isArray(value) ? value.filter((finding) => finding && typeof finding === 'object' && !Array.isArray(finding)) : []
}

function toHistoryItem(review) {
  return {
    id: review.id,
    project: review.project,
    scope: review.batch ? `${review.scope === 'Entire Project' ? 'Entire Project' : 'Selected Files'} (${review.coverage?.submitted ?? review.files?.length ?? 0})` : review.scope,
    status: review.status,
    provider: review.provider, repository: review.repository, coverage: review.coverage, errorCode: review.errorCode, model: review.model,
    batch: review.batch, files: review.files || [], findingsPage: review.findingsPage, reviewScope: review.scope,
    findings: typeof review.findingsCount === 'number' ? review.findingsCount : typeof review.findings === 'number' ? review.findings : asFindings(review.findings).length,
    updated: review.updatedAt ? new Date(review.updatedAt).toLocaleString() : 'Just now',
  }
}

function CodeReviewContent() {
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [isGenerating, setIsGenerating] = useState(false)
  const [isBatchSubmission,setIsBatchSubmission] = useState(false)
	const [reviews, setReviews] = useState([])
	const [selectedReviewId, setSelectedReviewId] = useState(null)
	const [findings, setFindings] = useState([])
	const [selectedFindingId, setSelectedFindingId] = useState(null)
	const [filters, setFilters] = useState({ severity: 'All', category: 'All', status: 'All' })
  const [isLoading,setIsLoading] = useState(true)
	const [statusMessage, setStatusMessage] = useState('')
	const [serverFindings, setServerFindings] = useState({})
  const [stats, setStats] = useState(null)
  const [qualityMetrics, setQualityMetrics] = useState(defaultQualityMetrics)
	const interactionRevision = useRef(0)
  const submissionBusy=useRef(false)
  const [findingOffset,setFindingOffset]=useState(0)
  const [pageLoading,setPageLoading]=useState(false)
  const [evidence,setEvidence]=useState(null)
  const [evidenceLoading,setEvidenceLoading]=useState(false)
	const token = useAuthStore((state) => state.token)
	const selectedReview = reviews.find((review) => review.id === selectedReviewId) || reviews[0]

	useEffect(() => {
		if (isMockToken(token)) return
		let cancelled = false
        const loadRevision = interactionRevision.current
		Promise.allSettled([
			repositoryReviewsApi.list(token),
			repositoryReviewBatchesApi.list(token),
			repositoryReviewsApi.stats(token)
		]).then(async ([single,batchResult,statsResult]) => {
      if(cancelled || loadRevision!==interactionRevision.current) return
      if (statsResult.status === 'fulfilled' && statsResult.value?.stats) {
        setStats(statsResult.value.stats)
        if (Array.isArray(statsResult.value.quality?.metrics)) {
          setQualityMetrics(statsResult.value.quality.metrics)
        }
      }
			const data=single.status==='fulfilled' ? single.value : {reviews:[]}
			const batches=batchResult.status==='fulfilled' && Array.isArray(batchResult.value.batches) ? batchResult.value.batches : []
			if(single.status==='rejected' || batchResult.status==='rejected') setStatusMessage([single,batchResult].filter((r)=>r.status==='rejected').map((r)=>r.reason.message).join(' '))
      if(batchResult.status==='fulfilled' && !Array.isArray(batchResult.value.batches)) setStatusMessage('Invalid batch history response. Saved work has not been verified.')
			if (cancelled || loadRevision !== interactionRevision.current || !Array.isArray(data?.reviews)) return
			const validReviews = data.reviews.filter((review) => review && typeof review === 'object' && typeof review.id === 'string')
            const childIds=new Set([...batches.flatMap((b)=>[...(b.files || []).map((f)=>f.reviewId), ...(b.childReviewIds || [])]), ...validReviews.filter((r)=>r.coverage?.batchId).map((r)=>r.id)].filter(Boolean))
            const combined=[...validReviews.filter((r)=>!childIds.has(r.id)),...batches].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
            const items = combined.map(toHistoryItem)
			const findingMap = {}
			for (const review of combined) findingMap[review.id] = asFindings(review.findings)
			setServerFindings(findingMap)
			setReviews(items)
			setSelectedReviewId(items[0]?.id || null)
			setFindings([])
			setSelectedFindingId(null)
            if (items[0]) {
              const record=items[0].batch ? (await repositoryReviewBatchesApi.get(token,items[0].id)).batch : (await repositoryReviewsApi.get(token, items[0].id)).review
              if (!cancelled && loadRevision === interactionRevision.current) { setReviews((current)=>current.map((r)=>r.id===record.id ? toHistoryItem(record) : r)); setFindings(asFindings(record.findings)); setServerFindings((current)=>({...current,[items[0].id]:asFindings(record.findings)})); setSelectedFindingId(record.findings[0]?.id || null) }
            }
		}).catch((err) => {
			if (!cancelled) setStatusMessage(err.message || 'Could not load reviews.')
		}).finally(() => { if (!cancelled) setIsLoading(false) })
		return () => { cancelled = true }
	}, [token])
  useEffect(()=>{
    if(isMockToken(token)) return
    let cancelled=false, busy=false
    const timer=setInterval(async()=>{
      if(busy) return
      busy=true
      const revision=interactionRevision.current
      try {
        const data=await repositoryReviewBatchesApi.list(token)
        if(cancelled || revision!==interactionRevision.current) return
        if(!Array.isArray(data.batches)) throw new Error('Invalid batch history response')
        const activeId=selectedReviewId || data.batches[0]?.id
        const selected=data.batches.some((b)=>b.id===activeId) ? (await repositoryReviewBatchesApi.get(token,activeId,findingOffset)).batch : null
        if(cancelled || revision!==interactionRevision.current) return
        if(selected) data.batches=data.batches.map((b)=>b.id===selected.id ? selected : b)
        setReviews((current) => {
          const childIds = new Set([
            ...data.batches.flatMap((b) => [...(b.files || []).map((f) => f.reviewId), ...(b.childReviewIds || [])]),
            ...current.filter((r) => r.coverage?.batchId).map((r) => r.id),
          ].filter(Boolean))
          return [...current.filter((r) => !r.batch && !childIds.has(r.id)), ...data.batches.map(toHistoryItem)]
        })
        if(selected) setServerFindings((current)=>({...current,[selected.id]:asFindings(selected.findings)}))
        if(selected) {if(!selectedReviewId)setSelectedReviewId(selected.id);setFindings(asFindings(selected.findings));setSelectedFindingId((id)=>selected.findings.some((f)=>f.id===id) ? id : selected.findings[0]?.id || null)}
        repositoryReviewsApi.stats(token).then((res)=>{if(!cancelled && revision===interactionRevision.current && res?.stats)setStats(res.stats)}).catch(()=>{})
      } catch(err) {if(!cancelled) setStatusMessage(`Batch progress could not be refreshed: ${err.message}. Saved work continues; check history before retrying.`)}
      finally {busy=false}
    },15000)
    return ()=>{cancelled=true;clearInterval(timer)}
  },[token,selectedReviewId,findingOffset])
	const isDemo = !!selectedReview && !['openrouter', 'gemini', 'deterministic'].includes(selectedReview?.provider)
    const resultLabel = !selectedReview ? 'No review selected' : isDemo ? 'Demo Data' : selectedReview?.provider === 'deterministic' ? 'Deterministic backend checks' : 'AI-generated review'
	const selectedFinding = findings.find((finding) => finding.id === selectedFindingId) || findings[0]
	const visibleFindings = useMemo(() => findings.filter((finding) => (filters.severity === 'All' || finding.severity === filters.severity) && (filters.category === 'All' || finding.category === filters.category) && (filters.status === 'All' || finding.status === filters.status)), [findings, filters])

  async function startReview(configuration) {
    if(submissionBusy.current) return
    submissionBusy.current=true
    interactionRevision.current++
    setIsGenerating(true); setIsBatchSubmission(!!configuration.fileIds || configuration.scope==='Entire Project'); setStatusMessage('')
    try {
      if (isMockToken(token)) throw new Error('Sign in to review uploaded source.')
      const data=configuration.fileIds || configuration.scope==='Entire Project' ? await repositoryReviewBatchesApi.create(token,configuration) : await repositoryReviewsApi.create(token,configuration)
      const record=data.batch || data.review
      if(!record?.id || !Array.isArray(record.findings)) throw new Error('Invalid review response. Check saved history before retrying.')
      setIsModalOpen(false);setFindingOffset(0);setEvidence(null)
      const results=asFindings(record.findings), item=toHistoryItem(record)
      setReviews((current)=>[item,...current.filter((r)=>r.id!==item.id)]); setSelectedReviewId(item.id); setServerFindings((current)=>({...current,[item.id]:results}))
      setFindings(results); setSelectedFindingId(results[0]?.id || null);  setFilters({severity:'All',category:'All',status:'All'})
      repositoryReviewsApi.stats(token).then((res)=>{if(res?.stats)setStats(res.stats)}).catch(()=>{})
    } catch(err) { throw new Error(err.name==='TimeoutError' ? 'Review request timed out. Check saved history; retrying this submission uses the same request key.' : err.message || 'Review failed.') }
    finally { submissionBusy.current=false;setIsGenerating(false) }
  }

	function analyzeCode(data) {
        if (!data || !Array.isArray(data.findings)) {
            setStatusMessage('Invalid analysis response. Try again or select Demo mode.')
            return
        }
        const { provider, file } = data
        const results = asFindings(data.findings)
        interactionRevision.current++
        const review = { id: `source-review-${Date.now()}`, project: provider === 'gemini' ? 'Gemini source code review' : provider === 'deterministic' ? 'Backend source code checks' : 'Local source code demo', scope: file || 'Source snippet', status: 'Completed', findings: results.length, updated: 'Just now', provider }
        setReviews((current) => [review, ...current])
        setServerFindings((current) => ({ ...current, [review.id]: results }))
        setSelectedReviewId(review.id)
        setFindings(results)
        setSelectedFindingId(results[0]?.id || null)
        setFilters({ severity: 'All', category: 'All', status: 'All' })
        setStatusMessage('')
    }

  async function selectReview(id) {
    const revision=++interactionRevision.current
    setFindingOffset(0);setEvidence(null);setSelectedReviewId(id); setStatusMessage(''); setFindings([]); setSelectedFindingId(null)
    try {
      const review=reviews.find((r)=>r.id===id)
      const record=review?.batch ? (await repositoryReviewBatchesApi.get(token,id)).batch : review?.repository ? (await repositoryReviewsApi.get(token,id)).review : null
      const results=record ? asFindings(record.findings) : asFindings(serverFindings[id])
      if (revision!==interactionRevision.current) return
      if(record) setReviews((current)=>current.map((r)=>r.id===id ? toHistoryItem(record) : r))
      setFindings(results); setSelectedFindingId(results[0]?.id || null); setServerFindings((current)=>({...current,[id]:results}))
    } catch(err) { setStatusMessage(err.message || 'Could not load findings.') }
  }
  async function updateFindingStatus(id,status) {
    const revision=++interactionRevision.current
    try {
      const finding=findings.find((f)=>f.id===id)
      const prevStatus=finding?.status
      if (prevStatus && prevStatus!==status) {
        setStats((curr)=>{
          if(!curr) return curr
          const wasOpen=prevStatus==='Open', isOpen=status==='Open'
          let openFindings=curr.openFindings, resolvedFindings=curr.resolvedFindings
          if(wasOpen && !isOpen) { openFindings=Math.max(0,openFindings-1); resolvedFindings+=1 }
          else if(!wasOpen && isOpen) { openFindings+=1; resolvedFindings=Math.max(0,resolvedFindings-1) }
          return {...curr, openFindings, resolvedFindings}
        })
      }
      const childId=selectedReview?.batch ? finding.reviewId : selectedReviewId
      const child=selectedReview?.repository ? asFindings((await repositoryReviewsApi.triage(token,childId,id,status)).review.findings) : null
      const updated=selectedReview?.batch ? findings.map((f)=>f.reviewId===childId ? {...f,...child.find((c)=>c.id===f.id)} : f) : child || findings.map((f)=>f.id===id ? {...f,status} : f)
      if(revision!==interactionRevision.current) return
      setFindings(updated); setServerFindings((current)=>({...current,[selectedReviewId]:updated}))
      repositoryReviewsApi.stats(token).then((res)=>{if(res?.stats)setStats(res.stats)}).catch(()=>{})
    } catch(err) { if(revision===interactionRevision.current) setStatusMessage(err.message || 'Could not save finding status.') }
  }

  async function changePage(offset){
    if(pageLoading) return
    const revision=++interactionRevision.current
    setPageLoading(true);setStatusMessage('')
    try{
      const record=(await repositoryReviewBatchesApi.get(token,selectedReviewId,offset)).batch
      if(revision!==interactionRevision.current)return
      const results=asFindings(record.findings)
      setReviews((current)=>current.map((r)=>r.id===record.id ? toHistoryItem(record) : r))
      setFindingOffset(offset);setFindings(results);setSelectedFindingId(results[0]?.id || null);setEvidence(null)
    }catch(err){if(revision===interactionRevision.current)setStatusMessage(err.message || 'Could not load findings page.')}
    finally{setPageLoading(false)}
  }
  async function loadEvidence(){
    const target=selectedFinding
    if(!target?.reviewId || evidenceLoading)return
    setEvidenceLoading(true)
    try{
      const record=(await repositoryReviewsApi.get(token,target.reviewId,AbortSignal.timeout(15000))).review
      const result=asFindings(record?.findings).find((f)=>f.id===target.id)
      if(!result)throw new Error('Finding evidence is unavailable.')
      setEvidence({...result,reviewId:target.reviewId})
    }catch(err){setStatusMessage(err.message || 'Could not load finding evidence.')}
    finally{setEvidenceLoading(false)}
  }
  const displayedFinding=evidence && selectedFinding && evidence.id===selectedFinding.id && evidence?.reviewId===selectedFinding?.reviewId ? {...selectedFinding,code:evidence.code,suggestedCode:evidence.suggestedCode} : selectedFinding

	return <section className="mx-auto w-full max-w-[1440px] min-w-0 px-5 py-8 sm:px-8 lg:py-10"><div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">Source code review</p><h2 className="text-3xl font-bold tracking-tight text-[#eef1f8] sm:text-4xl">Code Review</h2><p className="mt-2 max-w-2xl text-sm text-[#8f99b0] sm:text-base">Review source code for quality, maintainability, potential bugs, and improvement opportunities.</p></div><button type="button" onClick={() => setIsModalOpen(true)} className="btn-press btn-shine inline-flex w-fit items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] hover:bg-[#fbbf24] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/20"><Plus size={17} /> Start Review</button></div><ReviewStats stats={stats} /><DemoCodeInput onAnalyze={analyzeCode} /><section aria-label="Findings by severity" className="my-6"><h2 className="mb-3 text-sm font-bold text-[#b9c2d6]">{resultLabel} · Findings by severity{selectedReview?.findingsPage ? ' (current page)' : ''}</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{demoSeverities.map((severity) => <button type="button" key={severity} aria-pressed={filters.severity === severity} onClick={() => setFilters((current) => ({ ...current, severity: current.severity === severity ? 'All' : severity }))} className={`rounded-xl border p-4 text-left ${filters.severity === severity ? 'border-[#f59e0b] bg-[#1a2340]' : 'border-[#232c4b] bg-[#121a2e]'}`}><span className="block text-xs text-[#8f99b0]">{severity}</span><span className="mt-1 block text-2xl font-bold text-[#eef1f8]">{findings.filter((finding) => finding.severity === severity).length}</span></button>)}</div></section>{isGenerating ? <div className="generating-shimmer mt-7 flex items-center gap-3 rounded-xl border border-[#2b3558] bg-[#1a2340] p-5 text-sm font-semibold text-[#34d399]"><span className="inline-flex items-center gap-1" aria-hidden="true"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>{isBatchSubmission ? 'Saving background review batch...' : 'Reviewing uploaded source with Gemini. This can take up to 90 seconds...'}</div> : null}{statusMessage ? <p role="alert" className="mt-4 rounded-lg border border-[#2b3558] bg-[#1a2340] px-4 py-3 text-sm text-[#b9c2d6]">{statusMessage}</p> : null}<div className="mt-8 grid min-w-0 items-start gap-6 xl:grid-cols-[0.75fr_1.25fr]">{isLoading ? <p role="status" className="text-sm text-[#8f99b0]">Loading saved review history...</p> : <ReviewHistory reviews={reviews} selectedId={selectedReviewId} onSelect={selectReview} sourceLabel="Saved repository reviews and current pasted analyses" />}<div><ReviewSummary review={selectedReview} />{selectedReview?.batch && <BatchProgress review={selectedReview}/>}</div></div><div className="mt-8 grid min-w-0 gap-6 xl:grid-cols-[1.25fr_0.75fr]"><section className="min-w-0 rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"><div className="flex min-w-0 flex-col justify-between gap-4 border-b border-[#1e2642] pb-5 sm:flex-row sm:items-end"><div className="min-w-0"><h2 className="text-xl font-bold tracking-tight text-[#eef1f8]">Review Findings</h2><p className="mt-1 text-xs text-[#8f99b0]">Potential issues from {resultLabel} review data. Verify each result before acting.</p></div><span className="shrink-0 text-xs font-bold text-[#34d399]">{visibleFindings.length} shown</span></div>{selectedReview?.findingsPage && <nav aria-label="Finding pagination" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[#b9c2d6]"><p>Page {Math.floor(findingOffset/50)+1} of {Math.max(1,Math.ceil(selectedReview.findingsPage.total/50))} ? {selectedReview.findingsPage.total} total findings. Filters apply to this page.</p><button type="button" disabled={pageLoading || findingOffset===0} onClick={()=>changePage(Math.max(0,findingOffset-50))} className="text-[#34d399] disabled:opacity-50">Previous findings page</button><button type="button" disabled={pageLoading || !selectedReview.findingsPage.hasMore} onClick={()=>changePage(selectedReview.findingsPage.nextOffset)} className="text-[#34d399] disabled:opacity-50">Next findings page</button>{pageLoading && <p role="status">Loading findings page...</p>}</nav>}<div className="py-5"><FindingsFilters filters={filters} onChange={(key, value) => setFilters((current) => ({ ...current, [key]: value }))} /></div><div className="space-y-3">{visibleFindings.length ? visibleFindings.map((finding,index) => <div key={finding.id}>{selectedReview?.batch && (index===0 || visibleFindings[index-1].file!==finding.file) && <h3 className="mb-3 mt-5 font-mono text-sm text-[#dbe2ef]">{finding.file}</h3>}<FindingCard finding={finding} selected={finding.id === selectedFindingId} onSelect={() => setSelectedFindingId(finding.id)} onStatusChange={(status) => updateFindingStatus(finding.id, status)} /></div>) : <div className="rounded-lg border border-dashed border-[#2b3558] px-5 py-12 text-center"><p className="text-sm font-bold text-[#b9c2d6]">{findings.length ? 'No findings match the selected filters.' : selectedReview?.status === 'Failed' ? 'Review failed. No completed findings are available.' : ['Queued','In Progress'].includes(selectedReview?.status) ? 'Review has not completed. Background batch progress refreshes automatically.' : selectedReview ? 'No findings returned. This does not guarantee issue-free code.' : 'No review selected.'}</p><button type="button" onClick={() => setFilters({ severity: 'All', category: 'All', status: 'All' })} className="mt-3 text-xs font-bold text-[#34d399]">Clear filters</button></div>}</div></section><div className="min-w-0 space-y-6"><section className="min-w-0 rounded-xl border border-[#232c4b] bg-[#121a2e] p-5"><h2 className="text-xl font-bold tracking-tight text-[#eef1f8]">Selected Finding</h2>{selectedFinding ? <div className="mt-5 space-y-4"><div><p className="text-xs text-[#8f99b0]">Category</p><p className="mt-1 text-sm font-bold text-[#b9c2d6]">{selectedFinding.category}</p></div><div><p className="text-xs text-[#8f99b0]">Explanation</p><p className="mt-1 text-sm leading-6 text-[#8f99b0]">{selectedFinding.explanation || selectedFinding.problem}</p></div><div><p className="text-xs text-[#8f99b0]">Suggested improvement</p><p className="mt-1 text-sm leading-6 text-[#8f99b0]">{selectedFinding.improvement}</p></div>{selectedReview?.findingsPage && !displayedFinding.code && <button type="button" disabled={evidenceLoading} onClick={loadEvidence} className="text-sm text-[#34d399] underline">{evidenceLoading ? 'Loading evidence...' : 'Load source evidence and suggested fix'}</button>}<CodePreview finding={displayedFinding} />{displayedFinding.suggestedCode ? <div className="rounded-lg border border-[#34d399]/30 bg-[#0e1428] p-4"><p className="mb-2 text-xs font-bold text-[#34d399]">Suggested fix · illustrative snippet</p><pre className="overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-[#cdd6e8]"><code>{displayedFinding.suggestedCode}</code></pre></div> : null}</div> : <p className="mt-4 text-sm text-[#8f99b0]">Select a finding to inspect its preview.</p>}</section><div><QualityOverview metrics={qualityMetrics} /></div></div></div><StartReviewModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onStart={startReview} /></section>
}

export default function CodeReviewPage() {
  const email=useAuthStore((state)=>state.user?.email)
  return <CodeReviewContent key={email || 'signed-out'}/>
}
