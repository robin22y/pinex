import { useEffect, useState } from 'react'

// Single source of truth for the "is this a phone-sized viewport"
// check used by mobile/desktop conditional layouts (SectorBreadth,
// SectorDetail/All etc.). Bound to 768px to match Tailwind's md
// breakpoint and the rest of the codebase's responsive boundaries.
export function useIsMobile(breakpointPx = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < breakpointPx
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`)
    const handler = (e) => setIsMobile(e.matches)
    setIsMobile(mq.matches)
    mq.addEventListener?.('change', handler)
    return () => mq.removeEventListener?.('change', handler)
  }, [breakpointPx])

  return isMobile
}
