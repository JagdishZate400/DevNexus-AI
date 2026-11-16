import { Cpu } from 'lucide-react'

function Logo({ size = 36, iconSize = 20, className = '' }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`grid place-items-center rounded-lg bg-[#f59e0b] text-[#231303] transition-transform duration-300 hover:rotate-12 ${className}`}
    >
      <Cpu size={iconSize} strokeWidth={2.2} />
    </span>
  )
}

export default Logo
