function ProjectDetailsTabs({ activeTab, onChange }) {
  return <div className="flex gap-6 overflow-x-auto border-b border-[#232c4b]">{['Overview', 'Files', 'Activity', 'AI Analysis', 'Team'].map((tab) => <button key={tab} type="button" onClick={() => onChange(tab)} className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-bold ${activeTab === tab ? 'border-[#34d399] text-[#34d399]' : 'border-transparent text-[#8f99b0] hover:text-[#b9c2d6]'}`}>{tab}</button>)}</div>
}

export default ProjectDetailsTabs
