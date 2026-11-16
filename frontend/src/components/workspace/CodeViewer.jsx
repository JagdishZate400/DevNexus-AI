import { Code2 } from 'lucide-react'

function CodeViewer({ file }) {
  if (!file) return <div className="grid min-h-[380px] place-items-center px-6 text-center"><div><Code2 className="mx-auto text-[#8f99b0]" size={28} /><p className="mt-3 text-sm text-[#8f99b0]">Select a file from the project explorer.</p></div></div>
  const lines = String(file.content ?? '').split(/\r\n|\n|\r/)
  return <div className="min-h-[380px] min-w-0 max-w-full overflow-x-auto overflow-y-auto bg-[#0e1428] p-4 font-mono text-xs leading-6"><code className="block min-w-max">{lines.map((line, index) => <span key={`${file.name}-${index}`} className="flex"><span className="mr-5 inline-block w-7 select-none text-right text-[#8f99b0]">{index + 1}</span><span className="text-[#cdd6e8]">{line || ' '}</span></span>)}</code></div>
}

export default CodeViewer
