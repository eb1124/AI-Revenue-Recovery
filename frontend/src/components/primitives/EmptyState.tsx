import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface EmptyStateProps {
  /** Names what's missing, plainly — e.g. "No runs yet." (section 10.3). */
  title: string
  /** Names the next action — e.g. "Start one from the World screen." */
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-16 text-center', className)}>
      <p className="font-sans text-[15px] text-ink">{title}</p>
      {description && <p className="max-w-sm font-sans text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
