import { cn } from '../../lib/cn'
import { useAnimatedNumber } from '../../lib/useAnimatedNumber'
import { Eyebrow, Money, Rule } from '../primitives'

export interface HeldEntry {
  id: string
  /** Pre-formatted HH:MM — sim time at the moment of the hold. */
  time: string
  customerName: string
  amountPaise: number
}

interface HoldLedgerProps {
  marginProtectedPaise: number
  holdCount: number
  entries: HeldEntry[]
  className?: string
}

// "Meera Raghavan" -> "Meera R." — the mockup's own abbreviation, needed to
// keep the feed readable at 280px without truncating mid-word.
function abbreviateName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

/**
 * The signature element (section 10.2). A permanent 280px strip. Indigo is
 * the only colour used anywhere in this component — every other product
 * screen reserves indigo exclusively for this moment, so nothing here
 * borrows gain/burn/warn even though the amounts are money.
 */
export function HoldLedger({ marginProtectedPaise, holdCount, entries, className }: HoldLedgerProps) {
  const animatedTotal = useAnimatedNumber(marginProtectedPaise)

  return (
    <div className={cn('flex h-full w-70 shrink-0 flex-col', className)}>
      <div className="flex flex-col gap-1.5 px-4 py-3">
        <Eyebrow>Margin protected</Eyebrow>
        <Money paise={animatedTotal} size="xl" className="text-hold" />
        <p className="font-sans text-[13px] text-muted">
          <span className="font-mono tabular-nums text-ink">{holdCount.toLocaleString('en-IN')}</span> holds
        </p>
      </div>

      <Rule />

      <div className="hold-ledger-fade min-h-0 flex-1 overflow-hidden">
        <div className="flex flex-col gap-2.5 px-4 py-3">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-baseline gap-2">
              <span className="w-9 shrink-0 font-mono text-[11px] text-faint">{entry.time}</span>
              <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-ink">{abbreviateName(entry.customerName)}</span>
              <Money paise={entry.amountPaise} size="sm" className="shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
