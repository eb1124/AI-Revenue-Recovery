import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { Eyebrow } from './Eyebrow'

export type MetricDeltaTone = 'gain' | 'burn' | 'muted'

const deltaToneClasses: Record<MetricDeltaTone, string> = {
  gain: 'text-gain',
  burn: 'text-burn',
  muted: 'text-muted',
}

const valueSizeClasses = {
  md: 'text-[20px]',
  lg: 'text-[32px]',
} as const

interface MetricDelta {
  text: string
  /**
   * No tone is inferred from the delta's sign — a worse recovery rate is the
   * product's whole thesis (section 11.1), so "negative" doesn't mean "bad"
   * here. The caller decides.
   */
  tone?: MetricDeltaTone
}

interface MetricProps {
  label: string
  /** Usually a <Money> for rupee figures, or plain text for rates/counts. */
  value: ReactNode
  delta?: MetricDelta
  size?: keyof typeof valueSizeClasses
  className?: string
}

export function Metric({ label, value, delta, size = 'lg', className }: MetricProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Eyebrow>{label}</Eyebrow>
      <div className={cn('font-mono tabular-nums text-ink', valueSizeClasses[size])}>{value}</div>
      {delta && <div className={cn('font-mono text-[13px] tabular-nums', deltaToneClasses[delta.tone ?? 'muted'])}>{delta.text}</div>}
    </div>
  )
}
