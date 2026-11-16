function FindingsTabs({ selectedTab, onTabChange }) {
  const tabs = ['All Findings', 'Potential Bugs', 'Security Findings']

  return (
    <div className="flex gap-1 border-b border-[#232c4b]">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className={`px-4 py-3 text-sm font-semibold transition ${
            selectedTab === tab
              ? 'border-b-2 border-[#34d399] text-[#eef1f8]'
              : 'text-[#8f99b0] hover:text-[#b9c2d6]'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}

export default FindingsTabs
