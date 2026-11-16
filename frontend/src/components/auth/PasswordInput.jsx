import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

function PasswordInput({ id, label, value, onChange, placeholder, error, autoComplete }) {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-[#dbe2ef]">{label}</label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={isVisible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`w-full rounded-lg border bg-[#121a2e] px-3.5 py-3 pr-12 text-sm text-[#eef1f8] outline-none transition placeholder:text-[#8f99b0] focus:ring-4 ${error ? 'border-[#fbbf24] focus:border-[#fbbf24] focus:ring-[#fbbf24]/10' : 'border-[#2b3558] focus:border-[#f59e0b] focus:ring-[#f59e0b]/10'}`}
        />
        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-2 text-[#8f99b0] hover:bg-[#1a2340] hover:text-[#dbe2ef]"
          aria-label={isVisible ? 'Hide password' : 'Show password'}
        >
          {isVisible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {error && <p id={`${id}-error`} className="animate-shake mt-1.5 text-xs font-medium text-[#f87171]">{error}</p>}
    </div>
  )
}

export default PasswordInput
