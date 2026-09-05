import { useEffect } from 'react'
import { useSimulatePolicy } from '../../api/queries'
import type { Policy } from '../../api/schemas'
import { Eyebrow, Money } from '../primitives'

interface PolicyImpactProps {
  runId: string | null
  policy: Policy
}

/**
 * "Quiet hours blocked 71 messages this run. Estimated net profit effect:
 * −₹18,200." (section 10.10) — the blocked-count is the policy's real
 * `trigger_count`. The rupee figure comes from POST /api/policies/simulate,
 * labelled as an estimate rather than a precise number, since that
 * endpoint's mock math is a rough placeholder, not a real simulator re-run.
 */
export function PolicyImpact({ runId, policy }: PolicyImpactProps) {
  const simulate = useSimulatePolicy(runId)

  useEffect(() => {
    if (runId) simulate.mutate(policy.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, policy.id])

  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>Policy impact</Eyebrow>
      <p className="font-sans text-[13px] leading-[1.45] text-ink">
        <span className="text-muted">{policy.name} blocked</span> <span className="font-mono tabular-nums">{policy.trigger_count}</span>{' '}
        <span className="text-muted">messages this run.</span>
      </p>
      {simulate.data && (
        <p className="font-sans text-[13px] text-muted">
          Estimated net profit effect: <Money paise={simulate.data.net_profit_delta_paise} size="sm" signed />
        </p>
      )}
      <p className="font-sans text-[11px] text-faint">
        Kept on anyway — compliance isn't negotiable, even when it costs money.
      </p>
    </div>
  )
}
