import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { StatusDot } from './StatusDot'

interface ErrorStateProps {
  /** States what happened, plainly — e.g. "The run stopped at sim-day 12." (section 10.3, never "Oops!"). */
  title: string
  /** States what to do — e.g. "The event stream disconnected. Reconnecting." */
  description?: string
  action?: ReactNode
  className?: string
}

// Same neutral, centered shape as EmptyState — distinguished only by a
// leading error-tone StatusDot, not an alarm banner.
export function ErrorState({ title, description, action, className }: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-16 text-center', className)}>
      <div className="flex items-center gap-2">
        <StatusDot tone="error" />
        <p className="font-sans text-[15px] text-ink">{title}</p>
      </div>
      {description && <p className="max-w-sm font-sans text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
