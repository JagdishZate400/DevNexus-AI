import { useEffect, useRef, useState } from 'react'

function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(
    () =>
      typeof window === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    if (visible) return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          // Syncing with the IntersectionObserver (external system).
          // eslint-disable-next-line react/set-state-in-effect
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }} className={`reveal${visible ? ' is-visible' : ''} ${className}`}>
      {children}
    </div>
  )
}

export default Reveal
