import { ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import type { RunMetrics } from '../../api/schemas'
import { AXIS_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, toNumber } from '../../lib/chartTheme'

interface CalibrationPlotProps {
  calibration: RunMetrics['calibration']
}

const pct = (v: number) => `${Math.round(v * 100)}%`

// RunMetrics carries no Brier-score field — only the binned (predicted,
// observed, n) points section 10.8 asks to plot. Brier score is by
// definition the n-weighted mean squared error between predicted and
// observed, so this is a real statistic computed from the real bins, not a
// fabricated number.
function weightedBrierScore(points: RunMetrics['calibration']): number {
  const totalN = points.reduce((sum, p) => sum + p.n, 0)
  if (totalN === 0) return 0
  return points.reduce((sum, p) => sum + p.n * (p.predicted - p.observed) ** 2, 0) / totalN
}

/** Predicted vs observed, with the perfect-calibration diagonal (section 10.8). */
export function CalibrationPlot({ calibration }: CalibrationPlotProps) {
  const brier = weightedBrierScore(calibration)

  return (
    <div className="flex flex-col gap-2">
      {/* 5dp, not 4 — this model calibrates tightly enough (~0.00002 on the
          fixture data) that toFixed(4) rounds to a misleading "0.0000". */}
      <span className="font-mono text-[11px] text-muted">Brier {brier.toFixed(5)}</span>
      <ResponsiveContainer width="100%" height={200}>
        <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            type="number"
            dataKey="predicted"
            domain={[0, 1]}
            stroke={AXIS_STROKE}
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={{ stroke: AXIS_STROKE }}
            tickFormatter={pct}
          />
          <YAxis
            type="number"
            dataKey="observed"
            domain={[0, 1]}
            stroke={AXIS_STROKE}
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
            tickFormatter={pct}
            width={40}
          />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ]}
            stroke="var(--color-faint)"
            strokeDasharray="4 3"
            strokeWidth={2}
            ifOverflow="extendDomain"
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            formatter={(value, name) => [pct(toNumber(value)), name]}
            labelFormatter={() => ''}
          />
          <Scatter data={calibration} fill="var(--color-ink)" isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
      <p className="font-sans text-[13px] text-muted">Predicted vs observed recovery probability. The dashed line is perfect calibration.</p>
    </div>
  )
}
