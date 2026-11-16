function AuthInput({ id, label, type = 'text', value, onChange, placeholder, error, autoComplete, required = true }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-[#dbe2ef]">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`w-full rounded-lg border bg-[#121a2e] px-3.5 py-3 text-sm text-[#eef1f8] outline-none transition placeholder:text-[#8f99b0] focus:ring-4 ${error ? 'border-[#fbbf24] focus:border-[#fbbf24] focus:ring-[#fbbf24]/10' : 'border-[#2b3558] focus:border-[#f59e0b] focus:ring-[#f59e0b]/10'}`}
      />
      {error && <p id={`${id}-error`} className="animate-shake mt-1.5 text-xs font-medium text-[#f87171]">{error}</p>}
    </div>
  )
}

export default AuthInput
