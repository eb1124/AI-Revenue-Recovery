import { cn } from '../../lib/cn'

interface RuleProps {
  orientation?: 'horizontal' | 'vertical'
  className?: string
}

/** The one hairline every separator in the product is built from. Never a shadow, never >1px. */
export function Rule({ orientation = 'horizontal', className }: RuleProps) {
  if (orientation === 'vertical') {
    return <div className={cn('w-px self-stretch bg-rule', className)} aria-hidden />
  }
  return <div className={cn('h-px w-full bg-rule', className)} aria-hidden />
}
