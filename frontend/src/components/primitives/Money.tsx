import { formatPaise } from '../../lib/money'
import { cn } from '../../lib/cn'

export type MoneySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'display'

// The fixed type scale from section 10.2 (11 / 13 / 15 / 20 / 32 / 48).
const sizeClasses: Record<MoneySize, string> = {
  xs: 'text-[11px]',
  sm: 'text-[13px]',
  md: 'text-[15px]',
  lg: 'text-[20px]',
  xl: 'text-[32px]',
  display: 'text-[48px]',
}

interface MoneyProps {
  paise: number
  size?: MoneySize
  /** Colours positive --color-gain and negative --color-burn. Zero stays --color-ink. */
  signed?: boolean
  compact?: boolean
  className?: string
}

/** Every rupee figure in the product renders through this — mono, tabular-nums, en-IN grouping. */
export function Money({ paise, size = 'sm', signed = false, compact = false, className }: MoneyProps) {
  const toneClass = signed ? (paise > 0 ? 'text-gain' : paise < 0 ? 'text-burn' : 'text-ink') : 'text-ink'

  return (
    <span className={cn('font-mono tabular-nums', sizeClasses[size], toneClass, className)}>
      {formatPaise(paise, { compact })}
    </span>
  )
}
