import type { CSSProperties } from 'react'
import { cn } from '../../lib/cn'

interface EVIntervalProps {
  /** Pre-scaled (signed-log, see CandidateTable) — this component just draws a linear axis over whatever domain it's given. */
  ciLow: number
  ciHigh: number
  point: number
  /** Shared across every row in the table, so the zero line and scale line up (section 10.7). */
  domainMin: number
  span: number
  allowed: boolean
}

/**
 * One candidate's confidence interval, drawn against the table's shared zero
 * line — the single most information-dense element in the product (section
 * 10.7). The whisker draws left-to-right over 300ms on mount (section
 * 10.4, motion use #4); the end caps and point sit at their final position
 * throughout, so the animation reads as the bar reaching them.
 */
export function EVInterval({ ciLow, ciHigh, point, domainMin, span, allowed }: EVIntervalProps) {
  const leftPct = ((ciLow - domainMin) / span) * 100
  const rightPct = ((ciHigh - domainMin) / span) * 100
  const widthPct = Math.max(rightPct - leftPct, 0.5) // a zero-width interval (HOLD) still reads as a visible dot
  const pointPct = ((point - domainMin) / span) * 100
  const zeroPct = ((0 - domainMin) / span) * 100

  // The signed-log transform (CandidateTable) preserves sign exactly, so the
  // scaled point is still >= 0 iff the underlying EV was.
  const toneClass = !allowed ? 'bg-faint' : point >= 0 ? 'bg-gain' : 'bg-burn'

  const barStyle = {
    '--ev-zero-pct': `${zeroPct}%`,
    '--ev-left-pct': `${leftPct}%`,
    '--ev-width-pct': `${widthPct}%`,
  } as CSSProperties

  return (
    <div className="relative h-4 flex-1">
      <div className="absolute inset-y-0 w-px bg-rule" style={{ left: `${zeroPct}%` }} aria-hidden />
      <div className={cn('ev-interval-bar absolute top-1/2 h-px -translate-y-1/2', toneClass)} style={barStyle} />
      <div className={cn('absolute top-1/2 h-2 w-px -translate-y-1/2', toneClass)} style={{ left: `${leftPct}%` }} aria-hidden />
      <div className={cn('absolute top-1/2 h-2 w-px -translate-y-1/2', toneClass)} style={{ left: `${rightPct}%` }} aria-hidden />
      <div
        className={cn('absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full', toneClass)}
        style={{ left: `${pointPct}%` }}
        aria-hidden
      />
    </div>
  )
}
