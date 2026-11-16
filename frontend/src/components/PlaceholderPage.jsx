function PlaceholderPage({ title, description }) {
  return (
    <section className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-6xl flex-col justify-center px-5 py-10 sm:px-8">
      <div className="animate-stagger max-w-2xl">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em] text-[#fbbf24]">Coming next</p>
        <h2 className="text-4xl font-bold tracking-tight text-[#eef1f8] sm:text-5xl">{title}</h2>
        <p className="mt-5 max-w-xl text-lg leading-8 text-[#8f99b0]">{description}</p>
      </div>
    </section>
  )
}

export default PlaceholderPage
