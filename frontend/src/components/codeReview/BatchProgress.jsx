const errors = {
  ai_timeout: 'Gemini timed out.', ai_quota: 'Gemini quota or rate limit reached.', ai_unavailable: 'Gemini is unavailable.',
  ai_authentication: 'Gemini authentication failed; check server configuration.', ai_configuration: 'Queued model/provider differs from server configuration, or configuration is invalid.',
  ai_model_unavailable: 'Configured Gemini model is unavailable.', ai_request_rejected: 'Gemini rejected the request.',
  ai_malformed_response: 'Gemini returned invalid findings.', ai_blocked: 'Gemini blocked the output.', ai_output_limit: 'Gemini output exceeded its limit.',
  worker_interrupted: 'Worker interrupted; recovery is bounded to two attempts.', source_changed: 'Source changed since submission.',
  source_changed_or_unavailable: 'Source changed, was deleted, or ownership is unavailable.', source_missing: 'Source file is unavailable.',
}
export default function BatchProgress({review}) {
  const counts=review.coverage
  return <section aria-label="Batch progress" className="mt-4 rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 text-sm text-[#b9c2d6]">
    <p className="mb-2 font-bold">{review.reviewScope || 'Selected Files'}</p><h3 className="font-bold">Batch: {review.status}</h3>
    <p role="status" className="mt-2">Submitted {counts.submitted} · Pending {counts.pending} · Running {counts.running} · Reviewed {counts.reviewed} · Skipped {counts.skipped} · Failed {counts.failed}</p>
    <p className="mt-2 text-xs text-[#8f99b0]">Files are reviewed independently, without truncation. Only Reviewed files count as analyzed. Progress refreshes every 15 seconds; saved work continues after navigation.</p>
    {review.status==='Partial' && <p className="mt-2">Some files were not reviewed. Inspect skipped and failed files below.</p>}{review.status==='Failed' && <p className="mt-2">No files were successfully reviewed.</p>}<ul className="mt-4 max-h-96 overflow-auto space-y-3">{review.files.map((file)=><li key={file.fileId} className="break-words border-t border-[#232c4b] pt-3"><span className="font-mono">{file.path}</span> — {file.status} ({file.attempts} attempts)<p className="mt-1 text-xs text-[#8f99b0]">{file.lines} lines · {file.bytes} bytes · SHA-256 {file.sourceHash}</p>{file.errorCode && <p className="mt-1 text-xs text-red-400">{file.skipReason?.message || errors[file.errorCode] || 'Source validation or review failed.'} ({file.errorCode}){file.status==='Pending' ? ' Waiting for a bounded retry.' : ''}</p>}</li>)}</ul>
  </section>
}
