import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

interface EyebrowProps {
  children: ReactNode
  as?: 'span' | 'div'
  className?: string
}

/** Section heading label — Instrument Sans, 11px, uppercase, 0.09em tracking, faint. */
export function Eyebrow({ children, as: Tag = 'span', className }: EyebrowProps) {
  return <Tag className={cn('font-sans text-[11px] uppercase tracking-[0.09em] text-faint', className)}>{children}</Tag>
}
