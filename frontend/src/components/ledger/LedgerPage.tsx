import type { ReactNode } from 'react'
import { ApiError } from '../../api/client'
import { useRunMetrics } from '../../api/queries'
import { useRunStore } from '../../store/useRunStore'
import { Card, EmptyState, ErrorState, Eyebrow, Metric, Money, Rule } from '../primitives'
import { ActionMix } from './ActionMix'
import { ArmComparison } from './ArmComparison'
import { CalibrationPlot } from './CalibrationPlot'
import { ProfitWaterfall } from './ProfitWaterfall'
import { QiniCurve } from './QiniCurve'
import { SweepResult } from './SweepResult'

function ChartSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Eyebrow>{title}</Eyebrow>
      <Rule />
      <Card>{children}</Card>
    </section>
  )
}

// Section 10.8's own copy is illustrative ("...make 56% more") — this run's
// real deltas won't usually match that exactly, and 11.2 is explicit: do not
// fudge the numbers. So the sentence is built from the real deltas instead
// of hardcoding the example's figures, while keeping its shape and voice.
function buildRecoveryCaption(recoveryDelta: number, profitPct: number): string {
  const recoverPhrase =
    recoveryDelta < 0 ? 'recover less than the baseline' : recoveryDelta > 0 ? 'recover more than the baseline' : 'recover about the same as the baseline'
  const profitPhrase = profitPct >= 0 ? `make ${(profitPct * 100).toFixed(0)}% more` : `make ${Math.abs(profitPct * 100).toFixed(0)}% less`
  return `We ${recoverPhrase} and ${profitPhrase}. Recovery rate was always the wrong metric.`
}

/** The results screen (section 10.8) — the closing argument. */
export function LedgerPage() {
  const activeRunId = useRunStore((s) => s.activeRunId)
  const { data: metrics, isLoading, isError, error } = useRunMetrics(activeRunId)
  // A 404 here means "this run has no summary yet" (retry: false, see
  // useRunMetrics) — expected for a pending/running/failed run, not a real
  // failure. Any other error (network, 5xx, schema mismatch) is real.
  const isNotFound = error instanceof ApiError && error.status === 404

  if (!activeRunId) {
    return <EmptyState title="No run selected." description="Start one from the World screen." />
  }
  if (isLoading) {
    return <EmptyState title="Loading results…" />
  }
  if (isError && !isNotFound) {
    return <ErrorState title="Couldn't load results for this run." description="The request failed. Try reloading." />
  }
  if (!metrics) {
    return <EmptyState title="No results yet for this run." description="Results appear once the run completes." />
  }

  const { agent } = metrics.arms
  const { deltas } = metrics
  const recoveryDeltaText = `${deltas.recovery_rate_delta >= 0 ? '+' : '−'}${Math.abs(deltas.recovery_rate_delta * 100).toFixed(1)}pts vs baseline`

  return (
    <div className="flex flex-col gap-8 overflow-y-auto pb-10">
      <div className="grid grid-cols-3 gap-8 border-b border-rule pb-6">
        <Metric
          label="Net profit"
          value={<Money paise={agent.net_profit_paise} size="lg" />}
          delta={{
            text: `${deltas.net_profit_vs_baseline_pct >= 0 ? '+' : ''}${(deltas.net_profit_vs_baseline_pct * 100).toFixed(1)}% vs baseline`,
            tone: deltas.net_profit_vs_baseline_pct >= 0 ? 'gain' : 'burn',
          }}
          size="lg"
        />
        <Metric
          label="Margin protected"
          value={<Money paise={agent.margin_protected_paise} size="lg" className="text-hold" />}
          delta={{ text: `${agent.holds.toLocaleString('en-IN')} holds`, tone: 'muted' }}
          size="lg"
        />
        <div className="flex flex-col gap-1">
          <Metric label="Recovery rate" value={`${(agent.recovery_rate * 100).toFixed(1)}%`} delta={{ text: recoveryDeltaText, tone: 'muted' }} size="lg" />
          <p className="max-w-md font-sans text-[13px] text-muted">{buildRecoveryCaption(deltas.recovery_rate_delta, deltas.net_profit_vs_baseline_pct)}</p>
        </div>
      </div>

      <ChartSection title="Profit waterfall">
        <ProfitWaterfall agent={agent} />
      </ChartSection>

      <ChartSection title="Agent vs baseline vs holdout">
        <ArmComparison series={metrics.series} />
      </ChartSection>

      <div className="grid grid-cols-2 gap-8">
        <ChartSection title="Qini curve">
          <QiniCurve qini={metrics.qini} />
        </ChartSection>
        <ChartSection title="Calibration">
          <CalibrationPlot calibration={metrics.calibration} />
        </ChartSection>
      </div>

      <ChartSection title="Parameter sweep">
        <SweepResult />
      </ChartSection>

      <ChartSection title="Action mix">
        <ActionMix runId={activeRunId} />
      </ChartSection>
    </div>
  )
}
