import type { CaseListItem, Channel, RunMetrics, RunStreamEventName } from '../../src/api/schemas'
import { DIRECT_COST_PAISE } from './build'
import { makeIdFactory } from './ids'
import { type Rng, pick, randFloat, shuffle } from './rng'

export interface StreamEventEnvelope {
  event: RunStreamEventName
  data: unknown
}

interface Pending {
  tick: number
  event: RunStreamEventName
  data: unknown
}

function isMessageAction(action: string): boolean {
  return action === 'NUDGE_FREE' || action === 'NUDGE_INCENTIVE'
}

export function buildStreamEvents(
  rng: Rng,
  idf: ReturnType<typeof makeIdFactory>,
  opts: { runId: string; cases: CaseListItem[]; totalEvents: number; runMetrics: RunMetrics; targetLength: number },
): StreamEventEnvelope[] {
  const flowCandidates = shuffle(rng, opts.cases).slice(0, 115)
  const pending: Pending[] = []
  let tick = 0

  for (const c of flowCandidates) {
    tick += randFloat(rng, 0.4, 2.2)
    const detectedTick = tick
    pending.push({
      tick: detectedTick,
      event: 'case.detected',
      data: { id: c.id, customer: c.customer, kind: c.kind, value_at_risk_paise: c.value_at_risk_paise, arm: c.arm },
    })

    const decidedTick = detectedTick + randFloat(rng, 0.2, 1.5)
    pending.push({
      tick: decidedTick,
      event: 'case.decided',
      data: {
        id: c.id,
        action: c.decision.action,
        reason_code: c.decision.reason_code,
        margin_protected_paise: c.decision.action === 'HOLD' ? c.decision.margin_protected_paise : null,
        best_ev_paise: c.decision.best_ev_paise,
      },
    })

    if (c.decision.action !== 'HOLD') {
      const actedTick = decidedTick + randFloat(rng, 0.1, 1.0)
      const channel: Channel | null = isMessageAction(c.decision.action) ? (rng() < 0.8 ? 'whatsapp' : 'email') : null
      pending.push({
        tick: actedTick,
        event: 'case.acted',
        data: {
          id: c.id,
          action_id: idf('act'),
          type: c.decision.action,
          channel,
          cost_paise: DIRECT_COST_PAISE[c.decision.action],
        },
      })
    }

    const outcomeTick = decidedTick + randFloat(rng, 1.5, 6)
    pending.push({
      tick: outcomeTick,
      event: 'case.outcome',
      data: {
        id: c.id,
        resolution_path: c.outcome.resolution_path,
        net_profit_paise: c.outcome.net_profit_paise,
        incremental_profit_paise: Math.round(c.outcome.net_profit_paise * randFloat(rng, 0.3, 1)),
      },
    })
  }

  // A handful of guardrail blocks and a farming escalation, scattered through the run.
  for (let i = 0; i < 13; i++) {
    tick += randFloat(rng, 1, 6)
    const c = pick(rng, flowCandidates)
    pending.push({
      tick,
      event: 'guardrail.blocked',
      data: { id: c.id, action: 'NUDGE_INCENTIVE', policy_id: 'pol_no_incentive_flagged_farmer', policy_name: 'No incentives to flagged farmers' },
    })
  }
  tick += randFloat(rng, 5, 15)
  pending.push({
    tick,
    event: 'farming.escalated',
    data: { customer_id: idf('cus'), display_name: 'Rohit Menon', from_tier: 'watch', to_tier: 'flagged', score: 0.71 },
  })

  pending.sort((a, b) => a.tick - b.tick)
  const maxTick = pending[pending.length - 1]?.tick ?? 1

  // Periodic run.progress + metrics.tick ticks spread evenly across the run.
  const periodicCount = 60
  for (let i = 1; i <= periodicCount; i++) {
    const frac = i / periodicCount
    const t = frac * maxTick
    const simDay = Math.max(1, Math.round(frac * 30))
    const eventsProcessed = Math.round(frac * opts.totalEvents)

    pending.push({
      tick: t - 0.05,
      event: 'run.progress',
      data: { sim_day: simDay, events_processed: eventsProcessed, events_total: opts.totalEvents, speed: 2880 },
    })

    const agent = opts.runMetrics.arms.agent
    const baseline = opts.runMetrics.arms.baseline
    pending.push({
      tick: t,
      event: 'metrics.tick',
      data: {
        agent: {
          net_profit_paise: Math.round(agent.net_profit_paise * frac),
          margin_protected_paise: Math.round(agent.margin_protected_paise * frac),
          holds: Math.round(agent.holds * frac),
        },
        baseline: {
          net_profit_paise: Math.round(baseline.net_profit_paise * frac),
          margin_protected_paise: Math.round(baseline.margin_protected_paise * frac),
          holds: Math.round(baseline.holds * frac),
        },
      },
    })
  }

  pending.sort((a, b) => a.tick - b.tick)

  const trimmed = pending.slice(0, Math.max(0, opts.targetLength - 1))
  const envelopes: StreamEventEnvelope[] = trimmed.map((p) => ({ event: p.event, data: p.data }))
  envelopes.push({ event: 'run.completed', data: { run_id: opts.runId, summary: opts.runMetrics } })

  return envelopes
}
