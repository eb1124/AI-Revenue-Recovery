import { Link } from 'react-router-dom'
import { cn } from '../../lib/cn'
import { useUiStore } from '../../store/useUiStore'
import { Badge, Card, Eyebrow } from '../primitives'
import type { ResolvedItem } from './useFloorStream'

const MAX_SHOWN = 24

interface ResolvedGridProps {
  items: ResolvedItem[]
  /** Which card `j`/`k` currently has focused (section 10.6 Floor interactions). */
  selectedIndex?: number
}

/** HELD stamps on holds, RECOVERED/LOST labels on others. Max 24 shown, then "+ N more" to /cases (section 10.6). */
export function ResolvedGrid({ items, selectedIndex }: ResolvedGridProps) {
  if (items.length === 0) return null

  const shown = items.slice(0, MAX_SHOWN)
  const extra = items.length - shown.length

  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Resolved</Eyebrow>
      <div className="grid grid-cols-3 gap-2">
        {shown.map((item, index) => (
          <ResolvedCard key={item.id} item={item} selected={index === selectedIndex} />
        ))}
        {extra > 0 && (
          <Link
            to="/cases"
            className="flex items-center justify-center rounded border border-rule bg-card px-2 py-3 font-sans text-[11px] text-muted hover:text-ink"
          >
            + {extra} more
          </Link>
        )}
      </div>
    </div>
  )
}

function ResolvedCard({ item, selected }: { item: ResolvedItem; selected: boolean }) {
  const openCaseSheet = useUiStore((s) => s.openCaseSheet)

  if (item.isHeld) {
    return (
      <Card
        className={cn('flex cursor-pointer flex-col items-center justify-center gap-1.5 bg-paper py-3 hover:border-ink/40', selected && 'border-ink')}
        onClick={() => openCaseSheet(item.id)}
      >
        <span className="held-stamp rounded border border-hold px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-hold">
          Held
        </span>
        <span className="max-w-full truncate font-sans text-[11px] text-muted">{item.customerName}</span>
      </Card>
    )
  }

  return (
    <Card
      className={cn('flex cursor-pointer flex-col items-center justify-center gap-1.5 py-3 hover:border-ink/40', selected && 'border-ink')}
      onClick={() => openCaseSheet(item.id)}
    >
      <Badge tone={item.label === 'RECOVERED' ? 'gain' : 'burn'}>{item.label}</Badge>
      <span className="max-w-full truncate font-sans text-[11px] text-muted">{item.customerName}</span>
    </Card>
  )
}
