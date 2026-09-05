import { useState } from 'react'
import { useWorldSweep } from '../../api/queries'
import { EmptyState, Money } from '../primitives'

/**
 * "HOLD wins in 187 of 200 sampled worlds" (section 10.8/13), with the
 * losses expandable. WorldSweepResult carries no per-loss reason string —
 * only params + agent_net + baseline_net — so each loss's "reason" is the
 * real deficit between the two, not a guessed cause.
 */
export function SweepResult() {
  const { data, isLoading } = useWorldSweep()
  const [expanded, setExpanded] = useState(false)

  if (isLoading || !data) return <EmptyState title="Loading sweep…" className="py-8" />

  const wins = data.results.filter((r) => r.agent_wins)
  const losses = data.results.filter((r) => !r.agent_wins)
  const winPct = data.results.length > 0 ? (wins.length / data.results.length) * 100 : 0

  return (
    <div className="flex flex-col gap-3">
      <p className="font-sans text-[15px] text-ink">
        HOLD wins in <span className="font-mono tabular-nums">{wins.length}</span> of{' '}
        <span className="font-mono tabular-nums">{data.results.length}</span> sampled worlds.
      </p>

      <div className="flex h-3 w-full overflow-hidden bg-rule">
        <div className="h-full bg-gain" style={{ width: `${winPct}%` }} />
        <div className="h-full bg-burn" style={{ width: `${100 - winPct}%` }} />
      </div>

      {losses.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start font-sans text-[13px] text-muted underline decoration-rule underline-offset-2 hover:text-ink"
        >
          {expanded ? 'Hide' : 'Show'} the {losses.length} losses
        </button>
      )}

      {expanded && (
        <div className="flex flex-col">
          {losses.map((loss, i) => (
            <div key={i} className="flex items-baseline gap-3 border-t border-rule py-1.5 first:border-t-0">
              <span className="w-5 shrink-0 font-mono text-[11px] text-faint">{i + 1}</span>
              <span className="flex-1 font-sans text-[13px] text-muted">
                seed {loss.params.seed}: agent <Money paise={loss.agent_net} size="xs" /> vs baseline <Money paise={loss.baseline_net} size="xs" />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
