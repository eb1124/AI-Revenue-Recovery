import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface CardProps extends ComponentPropsWithoutRef<'div'> {
  children: ReactNode
  padded?: boolean
}

/** White on paper, one hairline, 4px radius. No shadow — no elevation anywhere in the product. */
export function Card({ children, padded = true, className, ...rest }: CardProps) {
  return (
    <div className={cn('rounded border border-rule bg-card', padded && 'p-4', className)} {...rest}>
      {children}
    </div>
  )
}
