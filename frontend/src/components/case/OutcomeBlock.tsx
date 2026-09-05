import type { Outcome } from '../../api/schemas'
import { formatSimDateTime } from '../../lib/format'
import { Money } from '../primitives'

interface OutcomeBlockProps {
  outcome: Outcome
  /** CaseListItem.headline — the one schema-backed narrative sentence for how this case resolved. */
  headline: string
}

/** What actually happened, and what would have happened without the agent (section 10.7). */
export function OutcomeBlock({ outcome, headline }: OutcomeBlockProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-sans text-[13px] leading-[1.45] text-muted">
        {headline} Resolved sim {formatSimDateTime(outcome.resolved_at_sim)}.
      </p>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <span className="font-sans text-[11px] text-faint">
          Recovered <Money paise={outcome.recovered_paise} size="xs" />
        </span>
        <span className="font-sans text-[11px] text-faint">
          Cost <Money paise={outcome.total_cost_paise} size="xs" />
        </span>
        <span className="font-sans text-[11px] text-faint">
          Counterfactual <Money paise={outcome.counterfactual_recovered_paise} size="xs" />
        </span>
        <span className="font-sans text-[11px] text-faint">
          Incremental <Money paise={outcome.incremental_profit_paise} size="xs" signed />
        </span>
      </div>
    </div>
  )
}
