import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ArmMetrics } from '../../api/schemas'
import { formatPaise } from '../../lib/money'
import { AXIS_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, toNumber } from '../../lib/chartTheme'

interface ProfitWaterfallProps {
  agent: ArmMetrics
}

interface WaterfallRow {
  name: string
  base: number
  value: number
  fill: string
}

/**
 * Value at risk → recovered → minus spend → net profit (section 10.8).
 * Recovered isn't additive on top of value at risk — it's a fraction of it —
 * so only the Spend bar floats (off Recovered); the other three are
 * independent reference bars from zero. ArmMetrics has no aggregate opt-out
 * cost field (only a customer count, `optouts` — the per-case cost only
 * exists at the case-file level as `annoyance_cost_paise`, nothing sums it
 * at the run level), so this doesn't fabricate a "minus opt-out cost" bar.
 */
export function ProfitWaterfall({ agent }: ProfitWaterfallProps) {
  const spendFloor = Math.max(agent.recovered_paise - agent.spend_paise, 0)

  const rows: WaterfallRow[] = [
    { name: 'Value at risk', base: 0, value: agent.value_at_risk_paise, fill: 'var(--color-ink)' },
    { name: 'Recovered', base: 0, value: agent.recovered_paise, fill: 'var(--color-gain)' },
    { name: '− Spend', base: spendFloor, value: agent.spend_paise, fill: 'var(--color-burn)' },
    { name: 'Net profit', base: 0, value: Math.abs(agent.net_profit_paise), fill: agent.net_profit_paise >= 0 ? 'var(--color-gain)' : 'var(--color-burn)' },
  ]

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <XAxis dataKey="name" stroke={AXIS_STROKE} tick={TICK_STYLE} tickLine={false} axisLine={{ stroke: AXIS_STROKE }} />
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
          cursor={{ fill: 'var(--color-rule)', opacity: 0.3 }}
          formatter={(value) => formatPaise(Math.round(toNumber(value)))}
        />
        <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="value" stackId="w" radius={0} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.name} fill={row.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
