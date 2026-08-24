import { cn } from '../../lib/cn'

export type StatusTone = 'live' | 'idle' | 'warn' | 'error'

// No dedicated "status" colour exists in the nine-token palette (section
// 10.2) — live/idle borrow ink/faint (plain UI chrome), warn/error borrow
// the money-adjacent warn/burn tones. Never hold (indigo stays reserved).
const toneClasses: Record<StatusTone, string> = {
  live: 'bg-ink',
  idle: 'bg-faint',
  warn: 'bg-warn',
  error: 'bg-burn',
}

interface StatusDotProps {
  tone?: StatusTone
  pulse?: boolean
  label?: string
  className?: string
}

export function StatusDot({ tone = 'idle', pulse = false, label, className }: StatusDotProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', toneClasses[tone], pulse && 'animate-pulse')} aria-hidden />
      {label && <span className="font-sans text-[13px] text-muted">{label}</span>}
    </span>
  )
}
