import type { Action, Candidate } from '../../api/schemas'
import { cn } from '../../lib/cn'
import { Money } from '../primitives'

interface EVTableProps {
  candidates: Candidate[]
  chosenAction: Action
}

// The chosen row's left border: indigo when the agent held (the one place
// outside the wordmark indigo is allowed), gain-green otherwise — a chosen
// non-HOLD action is definitionally positive-EV (section 4.3's decision
// rule only ever picks one when best.ev clears τ), so "gain" is the correct
// semantic colour, not an arbitrary accent.
function chosenBorderClass(chosenAction: Action): string {
  return chosenAction === 'HOLD' ? 'border-hold' : 'border-gain'
}

/** Six rows, zero at a fixed x-position — negative bars extend left, positive extend right (section 10.6). */
export function EVTable({ candidates, chosenAction }: EVTableProps) {
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank)
  const maxAbs = Math.max(1, ...sorted.map((c) => Math.abs(c.ev_paise)))

  return (
    <div className="flex flex-col">
      {sorted.map((candidate) => {
        const isChosen = candidate.action === chosenAction
        const fraction = Math.abs(candidate.ev_paise) / maxAbs
        const barColor = candidate.ev_paise >= 0 ? 'bg-gain' : 'bg-burn'

        return (
          <div
            key={candidate.action}
            title={candidate.allowed ? undefined : (candidate.block_reason ?? undefined)}
            className={cn(
              'flex items-center gap-3 border-l-2 py-1 pl-2',
              isChosen ? chosenBorderClass(chosenAction) : 'border-transparent',
              !candidate.allowed && 'opacity-40',
            )}
          >
            <span className={cn('w-32 shrink-0 font-mono text-[11px]', candidate.allowed ? 'text-ink' : 'text-muted line-through')}>
              {candidate.action}
            </span>
            <Money paise={candidate.ev_paise} size="xs" signed className="w-16 shrink-0 text-right" />
            <div className="relative h-2 flex-1">
              <div className="absolute inset-y-0 left-1/2 w-px bg-rule" aria-hidden />
              <div
                className={cn('absolute inset-y-0 rounded-[1px]', barColor)}
                style={
                  candidate.ev_paise >= 0
                    ? { left: '50%', width: `${fraction * 50}%` }
                    : { right: '50%', width: `${fraction * 50}%` }
                }
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
