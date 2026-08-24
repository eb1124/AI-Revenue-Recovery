import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface CardProps {
  children: ReactNode
  padded?: boolean
  className?: string
}

/** White on paper, one hairline, 4px radius. No shadow — no elevation anywhere in the product. */
export function Card({ children, padded = true, className }: CardProps) {
  return <div className={cn('rounded border border-rule bg-card', padded && 'p-4', className)}>{children}</div>
}
