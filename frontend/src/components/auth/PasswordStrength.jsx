import { Check } from 'lucide-react'
import { passwordChecks, passwordScore, strengthLabel } from '../../utils/validation'

function PasswordStrength({ password }) {
  if (!password) return null
  const score = passwordScore(password)
  const { label, color } = strengthLabel(score)
  const checks = passwordChecks(password)

  return (
    <div className="animate-fade-in mt-2.5" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 gap-1" aria-hidden="true">
          {checks.map((check, index) => (
            <span
              key={check.label}
              className="h-1.5 flex-1 rounded-full transition-colors duration-300"
              style={{ backgroundColor: index < score ? color : '#232c4b' }}
            />
          ))}
        </div>
        <span className="text-xs font-bold" style={{ color }}>{label}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {checks.filter((check) => !check.ok).map((check) => (
          <li key={check.label} className="flex items-center gap-1.5 text-[11px] text-[#8f99b0]">
            <Check size={11} className="text-[#34d399]" /> Add {check.label.charAt(0).toLowerCase() + check.label.slice(1)}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default PasswordStrength
