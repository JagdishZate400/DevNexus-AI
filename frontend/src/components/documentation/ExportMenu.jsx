import { Download } from 'lucide-react'
import { useState } from 'react'

function ExportMenu({ document: exportedDocument }) {
  const [isOpen, setIsOpen] = useState(false)

  if (!exportedDocument) return null

  function downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
    setIsOpen(false)
  }

  function handleExportMarkdown() {
    const filename = `${exportedDocument.title.toLowerCase().replace(/\s+/g, '-')}.md`
    downloadFile(filename, exportedDocument.content, 'text/markdown')
  }

  function handleExportText() {
    const filename = `${exportedDocument.title.toLowerCase().replace(/\s+/g, '-')}.txt`
    downloadFile(filename, exportedDocument.content, 'text/plain')
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 rounded-lg bg-[#e8eff5] px-3 py-2 text-xs font-bold text-[#3d5a7a] transition hover:bg-[#1a2340]"
      >
        <Download size={15} /> Export
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 rounded-lg border border-[#232c4b] bg-[#121a2e] shadow-lg">
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="block w-full px-3 py-2 text-left text-xs font-semibold text-[#dbe2ef] transition hover:bg-[#1a2340]"
          >
            Export as Markdown
          </button>
          <button
            type="button"
            onClick={handleExportText}
            className="block w-full border-t border-[#1e2642] px-3 py-2 text-left text-xs font-semibold text-[#dbe2ef] transition hover:bg-[#1a2340]"
          >
            Export as Text
          </button>
        </div>
      )}
    </div>
  )
}

export default ExportMenu
