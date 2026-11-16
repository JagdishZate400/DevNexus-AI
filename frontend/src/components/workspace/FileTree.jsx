import { FolderTree } from 'lucide-react'
import FileTreeItem from './FileTreeItem'

function FileTree({ tree, expandedFolders, onToggle, selectedFile, onSelect }) {
  return <div className="flex min-h-[420px] flex-col"><div className="flex items-center gap-2 border-b border-[#1e2642] px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-[#8f99b0]"><FolderTree size={15} /> File Explorer</div><div className="flex-1 overflow-y-auto py-3">{tree.map((item) => <FileTreeItem key={item.name} item={item} path={item.name} expandedFolders={expandedFolders} onToggle={onToggle} selectedFile={selectedFile} onSelect={onSelect} />)}</div></div>
}

export default FileTree
