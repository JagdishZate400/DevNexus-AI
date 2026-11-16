import { ChevronDown, ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen } from 'lucide-react'

function FileTreeItem({ item, depth = 0, path, expandedFolders, onToggle, selectedFile, onSelect }) {
  const isFolder = item.type === 'folder'
  const isExpanded = expandedFolders.has(path)
  const isSelected = selectedFile?.path === path
  const FileIcon = item.language === 'JSON' ? FileJson : item.language === 'Markdown' ? FileText : FileCode2
  return <div><button type="button" onClick={() => isFolder ? onToggle(path) : onSelect({ ...item, path })} className={`flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs transition-colors ${isSelected ? 'bg-[#1a2340] font-bold text-[#fcd34d]' : 'text-[#8f99b0] hover:bg-[#1a2340] hover:text-[#dbe2ef]'}`} style={{ paddingLeft: `${10 + depth * 16}px` }} aria-expanded={isFolder ? isExpanded : undefined}>{isFolder ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-3.5" />}{isFolder ? (isExpanded ? <FolderOpen size={15} className="text-[#34d399]" /> : <Folder size={15} className="text-[#34d399]" />) : <FileIcon size={15} className="text-[#8f99b0]" />}<span className="truncate">{item.name}</span></button>{isFolder && isExpanded && <div className="animate-fade-in">{item.children?.length ? item.children.map((child) => <FileTreeItem key={`${path}/${child.name}`} item={child} depth={depth + 1} path={`${path}/${child.name}`} expandedFolders={expandedFolders} onToggle={onToggle} selectedFile={selectedFile} onSelect={onSelect} />) : <p className="py-2 text-xs italic text-[#8f99b0]" style={{ paddingLeft: `${42 + depth * 16}px` }}>This folder is empty.</p>}</div>}</div>
}

export default FileTreeItem
