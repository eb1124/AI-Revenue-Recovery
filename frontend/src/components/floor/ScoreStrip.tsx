import { ApiError } from '../../api/client'
import { useRunMetrics } from '../../api/queries'
import { cn } from '../../lib/cn'
import { useAnimatedNumber } from '../../lib/useAnimatedNumber'
import { useRunStore } from '../../store/useRunStore'
import { Eyebrow, Money, Rule } from '../primitives'

function ScoreSegment({ label, netPaise }: { label: string; netPaise: number }) {
  const animated = useAnimatedNumber(netPaise)
  return (
    <div className="flex items-baseline gap-2">
      <Eyebrow>{label}</Eyebrow>
      <Money paise={animated} size="md" />
      <span className="font-sans text-[11px] text-faint">net</span>
    </div>
  )
}

/** Bottom. Three arm totals + delta. Counters animate (section 10.6). */
export function ScoreStrip() {
  const activeRunId = useRunStore((s) => s.activeRunId)
  const { data: metrics, isLoading, isError, error } = useRunMetrics(activeRunId)
  const isNotFound = error instanceof ApiError && error.status === 404

  if (!activeRunId) return null

  if (isLoading) {
    return (
      <div className="flex h-10 items-center border-t border-rule px-6">
        <span className="font-sans text-[13px] text-muted">Loading results…</span>
      </div>
    )
  }

  if (isError && !isNotFound) {
    return (
      <div className="flex h-10 items-center border-t border-rule px-6">
        <span className="font-sans text-[13px] text-burn">Couldn't load results for this run.</span>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="flex h-10 items-center border-t border-rule px-6">
        <span className="font-sans text-[13px] text-muted">No results yet for this run.</span>
      </div>
    )
  }

  const { agent, baseline, holdout } = metrics.arms
  const deltaPct = metrics.deltas.net_profit_vs_baseline_pct
  const deltaText = `${deltaPct >= 0 ? '+' : ''}${(deltaPct * 100).toFixed(1)}%`

  return (
    <div className="flex h-10 items-center gap-5 border-t border-rule px-6">
      <ScoreSegment label="Agent" netPaise={agent.net_profit_paise} />
      <Rule orientation="vertical" className="h-5" />
      <ScoreSegment label="Baseline" netPaise={baseline.net_profit_paise} />
      <Rule orientation="vertical" className="h-5" />
      <ScoreSegment label="Holdout" netPaise={holdout.net_profit_paise} />
      <Rule orientation="vertical" className="h-5" />
      <span className={cn('font-mono text-[13px] tabular-nums', deltaPct >= 0 ? 'text-gain' : 'text-burn')}>{deltaText}</span>
    </div>
  )
}
