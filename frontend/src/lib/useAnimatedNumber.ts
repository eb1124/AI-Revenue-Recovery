import { useEffect, useRef, useState } from 'react'

/**
 * Eases from the previous value to `target` over `durationMs` — the "rupee
 * counters tick with a 400ms ease-out interpolation" rule (section 10.4,
 * motion use #1). Respects prefers-reduced-motion by jumping straight to
 * the target instead of animating.
 */
export function useAnimatedNumber(target: number, durationMs = 400): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (target === fromRef.current) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      setValue(target)
      fromRef.current = target
      return
    }

    const from = fromRef.current
    let start: number | null = null

    function tick(now: number) {
      if (start === null) start = now
      const elapsed = now - start
      const t = Math.min(1, elapsed / durationMs)
      const eased = 1 - (1 - t) * (1 - t) // ease-out quad, no bounce
      setValue(Math.round(from + (target - from) * eased))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, durationMs])

  return value
}
