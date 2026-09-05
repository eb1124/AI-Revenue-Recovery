import { useMemo } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useCasesByArm } from '../../api/queries'
import { ActionSchema, type Action, type CaseListItem } from '../../api/schemas'
import { EmptyState } from '../primitives'
import { AXIS_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE } from '../../lib/chartTheme'

interface ActionMixProps {
  runId: string
}

// HOLD gets the one reserved indigo; every other action shares the neutral
// ink hue at decreasing opacity, in this fixed order — so indigo is the only
// saturated colour in the whole stack, which is the point (section 10.8:
// "the agent's largest block is HOLD, indigo, and the baseline has none").
const ACTION_ORDER: Action[] = ['HOLD', 'RETRY_NOW', 'RETRY_SCHEDULED', 'NUDGE_FREE', 'NUDGE_INCENTIVE', 'ESCALATE_HUMAN']
const ACTION_COLOR: Record<Action, string> = {
  HOLD: 'var(--color-hold)',
  RETRY_NOW: 'var(--color-ink)',
  RETRY_SCHEDULED: 'color-mix(in srgb, var(--color-ink) 78%, transparent)',
  NUDGE_FREE: 'color-mix(in srgb, var(--color-ink) 56%, transparent)',
  NUDGE_INCENTIVE: 'color-mix(in srgb, var(--color-ink) 34%, transparent)',
  ESCALATE_HUMAN: 'color-mix(in srgb, var(--color-ink) 18%, transparent)',
}

function tally(items: CaseListItem[]): Record<Action, number> {
  const counts = Object.fromEntries(ActionSchema.options.map((a) => [a, 0])) as Record<Action, number>
  for (const item of items) counts[item.decision.action] += 1
  return counts
}

// RunMetrics/ArmMetrics has no per-action-type breakdown (only a total
// `actions_taken` and the `holds` count) — this tallies the real case list
// client-side instead of approximating it (see useCasesByArm).
export function ActionMix({ runId }: ActionMixProps) {
  const agentQuery = useCasesByArm(runId, 'agent')
  const baselineQuery = useCasesByArm(runId, 'baseline')

  const rows = useMemo(() => {
    if (!agentQuery.data || !baselineQuery.data) return null
    return [
      { arm: 'Agent', ...tally(agentQuery.data.items) },
      { arm: 'Baseline', ...tally(baselineQuery.data.items) },
    ]
  }, [agentQuery.data, baselineQuery.data])

  if (!rows) return <EmptyState title="Loading action mix…" className="py-8" />

  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="35%">
          <XAxis type="number" stroke={AXIS_STROKE} tick={TICK_STYLE} tickLine={false} axisLine={{ stroke: AXIS_STROKE }} />
          <YAxis type="category" dataKey="arm" stroke={AXIS_STROKE} tick={TICK_STYLE} tickLine={false} axisLine={false} width={56} />
          <Tooltip contentStyle={TOOLTIP_CONTENT_STYLE} labelStyle={TOOLTIP_LABEL_STYLE} />
          {ACTION_ORDER.map((action) => (
            <Bar key={action} dataKey={action} name={action} stackId="mix" fill={ACTION_COLOR[action]} radius={0} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {ACTION_ORDER.map((action) => (
          <span key={action} className="inline-flex items-center gap-1 font-mono text-[11px] text-muted">
            <span className="inline-block h-2 w-2 shrink-0" style={{ background: ACTION_COLOR[action] }} aria-hidden />
            {action}
          </span>
        ))}
      </div>
    </div>
  )
}
