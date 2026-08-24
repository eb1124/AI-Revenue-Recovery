import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeTone = 'default' | 'muted' | 'warn' | 'gain' | 'burn' | 'hold'

// Tints are opacity variants of the same nine tokens (section 10.2), not new
// colours. `hold` (indigo) is reserved for literal HOLD-decision contexts —
// do not reach for it as a generic "info" tone.
const toneClasses: Record<BadgeTone, string> = {
  default: 'border-rule bg-card text-ink',
  muted: 'border-rule bg-paper text-muted',
  warn: 'border-warn/25 bg-warn/10 text-warn',
  gain: 'border-gain/25 bg-gain/10 text-gain',
  burn: 'border-burn/25 bg-burn/10 text-burn',
  hold: 'border-hold/25 bg-hold/10 text-hold',
}

interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}

export function Badge({ children, tone = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-sans text-[11px] uppercase tracking-[0.04em] leading-none',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
