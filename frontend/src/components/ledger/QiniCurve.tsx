import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RunMetrics } from '../../api/schemas'
import { AXIS_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, toNumber } from '../../lib/chartTheme'

interface QiniCurveProps {
  qini: RunMetrics['qini']
}

const pct = (v: number) => `${Math.round(v * 100)}%`

/** Model curve vs random diagonal (section 10.8) — the gap above the diagonal is the uplift model earning its keep. */
export function QiniCurve({ qini }: QiniCurveProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] text-muted">Qini {qini.coefficient.toFixed(2)}</span>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={qini.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis dataKey="fraction" stroke={AXIS_STROKE} tick={TICK_STYLE} tickLine={false} axisLine={{ stroke: AXIS_STROKE }} tickFormatter={pct} />
          <YAxis stroke={AXIS_STROKE} tick={TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={pct} width={40} />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            labelFormatter={(v) => `Targeted ${pct(toNumber(v))}`}
            formatter={(value) => pct(toNumber(value))}
          />
          <Line type="monotone" dataKey="agent" name="Model" stroke="var(--color-ink)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line
            type="linear"
            dataKey="random"
            name="Random"
            stroke="var(--color-faint)"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="font-sans text-[13px] text-muted">Uplift model quality. Random targeting is the diagonal.</p>
    </div>
  )
}
