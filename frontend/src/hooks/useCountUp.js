import { useEffect, useState } from 'react'

// Counts from 0 to a numeric target on mount (e.g. StatCard values).
// Non-numeric values render as-is; reduced-motion renders the final value.
export function useCountUp(target, duration = 900) {
  const numeric = Number.parseFloat(target)
  const isNumeric = Number.isFinite(numeric)
  const prefersReduced = () =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Final value up-front for non-numeric targets and reduced-motion users,
  // so the effect below only runs the animation loop itself.
  const [value, setValue] = useState(isNumeric && !prefersReduced() ? 0 : target)

  useEffect(() => {
    if (!isNumeric || prefersReduced()) return
    let raf
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      const current = numeric * eased
      // Animation frame loop: syncing visual state with the timer.
      // eslint-disable-next-line react/set-state-in-effect
      setValue(Number.isInteger(numeric) ? Math.round(current) : current.toFixed(1))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, isNumeric, numeric])

  return value
}
