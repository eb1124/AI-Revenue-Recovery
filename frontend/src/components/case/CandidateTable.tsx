import type { Action, Candidate } from '../../api/schemas'
import { cn } from '../../lib/cn'
import { Eyebrow, Money } from '../primitives'
import { EVInterval } from './EVInterval'

interface CandidateTableProps {
  candidates: Candidate[]
  chosenAction: Action
}

// 4.2's EV equation: EV = gross_gain − direct − incentive − annoyance − farming.
// The wireframe's single "cost" column is the sum of the four cost terms.
function totalCostPaise(c: Candidate): number {
  return c.direct_cost_paise + c.incentive_cost_paise + c.annoyance_cost_paise + c.farming_cost_paise
}

// The chosen row's left border: indigo when the agent held (the one place
// outside the wordmark indigo is allowed), gain-green otherwise — a chosen
// non-HOLD action is definitionally positive-EV.
function chosenBorderClass(chosenAction: Action): string {
  return chosenAction === 'HOLD' ? 'border-hold' : 'border-gain'
}

// A signed-log transform, not raw paise, sets the interval axis. Candidate
// costs in one case can span a 20x range (a few rupees for a nudge vs. a
// couple hundred for ESCALATE_HUMAN) — on a linear shared scale, that one
// outlier swallows the axis and the other five intervals collapse into an
// unreadable dot, defeating the "see every interval at a glance" point of
// this element. log1p keeps the sign (so the shared zero line is unchanged)
// and keeps 0 fixed at 0, while compressing the outlier enough that every
// row's whisker stays legible.
function compress(paise: number): number {
  return Math.sign(paise) * Math.log1p(Math.abs(paise) / 100)
}

/**
 * Six candidate rows sharing one fixed zero line (section 10.7) — so an
 * interval crossing zero is visible at a glance across every row, not just
 * within its own. HOLD's uplift/gain/cost are definitionally zero, so those
 * three columns read as "—" for that row, matching the wireframe.
 */
export function CandidateTable({ candidates, chosenAction }: CandidateTableProps) {
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank)
  const scaled = sorted.map((c) => ({ candidate: c, low: compress(c.ci_low_paise), high: compress(c.ci_high_paise), point: compress(c.ev_paise) }))
  const domainMin = Math.min(0, ...scaled.map((s) => s.low))
  const domainMax = Math.max(0, ...scaled.map((s) => s.high))
  const span = Math.max(domainMax - domainMin, 1e-6)
  const zeroPct = ((0 - domainMin) / span) * 100

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 pb-1.5">
        <Eyebrow as="div" className="w-32 shrink-0">
          Action
        </Eyebrow>
        <Eyebrow as="div" className="w-12 shrink-0 text-right">
          Uplift
        </Eyebrow>
        <Eyebrow as="div" className="w-16 shrink-0 text-right">
          Gain
        </Eyebrow>
        <Eyebrow as="div" className="w-16 shrink-0 text-right">
          Cost
        </Eyebrow>
        <Eyebrow as="div" className="w-16 shrink-0 text-right">
          EV
        </Eyebrow>
        <div className="relative h-3 flex-1">
          <span
            className="absolute -translate-x-1/2 font-sans text-[11px] uppercase tracking-[0.09em] text-faint"
            style={{ left: `${zeroPct}%` }}
          >
            0
          </span>
        </div>
      </div>

      {scaled.map(({ candidate: c, low, high, point }) => {
        const isChosen = c.action === chosenAction
        const isHoldRow = c.action === 'HOLD'

        return (
          <div
            key={c.action}
            title={c.allowed ? undefined : (c.block_reason ?? undefined)}
            className={cn(
              'flex items-center gap-3 border-l-2 py-1 pl-2',
              isChosen ? chosenBorderClass(chosenAction) : 'border-transparent',
              !c.allowed && 'opacity-40',
            )}
          >
            <span className={cn('w-32 shrink-0 truncate font-mono text-[11px]', c.allowed ? 'text-ink' : 'text-muted line-through')}>
              {c.action}
            </span>
            <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
              {isHoldRow ? '—' : c.uplift.toFixed(2)}
            </span>
            {isHoldRow ? (
              <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted">—</span>
            ) : (
              <Money paise={c.gross_gain_paise} size="xs" className="w-16 shrink-0 text-right" />
            )}
            {isHoldRow ? (
              <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted">—</span>
            ) : (
              <Money paise={totalCostPaise(c)} size="xs" className="w-16 shrink-0 text-right" />
            )}
            <Money paise={c.ev_paise} size="xs" signed className="w-16 shrink-0 text-right" />
            <EVInterval ciLow={low} ciHigh={high} point={point} domainMin={domainMin} span={span} allowed={c.allowed} />
          </div>
        )
      })}
    </div>
  )
}
