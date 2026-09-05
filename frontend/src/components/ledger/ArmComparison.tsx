import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { RunMetrics } from '../../api/schemas'
import { cn } from '../../lib/cn'
import { formatPaise } from '../../lib/money'
import { AXIS_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, toNumber } from '../../lib/chartTheme'

interface ArmComparisonProps {
  series: RunMetrics['series']
}

// No <Legend/> box (this task's instruction) — a plain-text key with a real
// solid/dashed sample reads the same information without the chrome.
function SeriesKey({ label, colorVar, dashed }: { label: string; colorVar: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-sans text-[11px] text-muted">
      <span className={cn('inline-block h-0 w-4 border-t-2', dashed && 'border-dashed')} style={{ borderColor: colorVar }} aria-hidden />
      {label}
    </span>
  )
}

/** Net profit over sim days, three arms on one shared axis — holdout as a dashed hairline (section 10.8). */
export function ArmComparison({ series }: ArmComparisonProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <SeriesKey label="Agent" colorVar="var(--color-ink)" />
        <SeriesKey label="Baseline" colorVar="var(--color-muted)" />
        <SeriesKey label="Holdout" colorVar="var(--color-faint)" dashed />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="sim_day"
            stroke={AXIS_STROKE}
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={{ stroke: AXIS_STROKE }}
            tickFormatter={(v: number) => `d${v}`}
          />
          <YAxis
            stroke={AXIS_STROKE}
            tick={TICK_STYLE}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatPaise(v, { compact: true })}
            width={56}
          />
          <Tooltip
            contentStyle={TOOLTIP_CONTENT_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            labelFormatter={(v) => `Sim day ${toNumber(v)}`}
            formatter={(value) => formatPaise(Math.round(toNumber(value)))}
          />
          <Line type="monotone" dataKey="agent_net_paise" name="Agent" stroke="var(--color-ink)" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line
            type="monotone"
            dataKey="baseline_net_paise"
            name="Baseline"
            stroke="var(--color-muted)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="holdout_net_paise"
            name="Holdout"
            stroke="var(--color-faint)"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
