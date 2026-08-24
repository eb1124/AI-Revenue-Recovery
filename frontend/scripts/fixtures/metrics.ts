import type { ArmMetrics, RunMetrics } from '../../src/api/schemas'
import { type Rng, randInt } from './rng'

// Computed (not hand-typed) so every derived figure is internally consistent
// and lands inside the section 11.2 target bands:
//   agent net profit 50–65% above baseline · recovery rate 1–3pts below
//   baseline · spend 35–45% below baseline · HOLD on 30–38% of events ·
//   opt-outs agent ~11, baseline ~40.

function jitterInt(rng: Rng, v: number, spread: number): number {
  return Math.round(v) + randInt(rng, -spread, spread)
}

export function buildMetrics(rng: Rng, runId: string): RunMetrics {
  const events = 1184
  const valueAtRiskPaise = jitterInt(rng, 74_238_600, 4000)

  const marginRate = 0.222

  // --- baseline arm: dumb rules, high spend, decent recovery -----------------
  const baselineRecoveryRate = 0.447
  const baselineRecoveredPaise = Math.round(valueAtRiskPaise * baselineRecoveryRate)
  const baselineSpendPaise = jitterInt(rng, 1_612_400, 6000)
  const baselineNetPaise = Math.round(baselineRecoveredPaise * marginRate) - baselineSpendPaise
  const baseline: ArmMetrics = {
    events,
    value_at_risk_paise: valueAtRiskPaise,
    recovered_paise: baselineRecoveredPaise,
    spend_paise: baselineSpendPaise,
    net_profit_paise: baselineNetPaise,
    incremental_profit_paise: jitterInt(rng, Math.round(baselineNetPaise * 0.22), 5000),
    recovery_rate: baselineRecoveryRate,
    actions_taken: 1091,
    holds: 93,
    margin_protected_paise: jitterInt(rng, 118_400, 3000),
    optouts: 41,
    messages_sent: 968,
  }

  // --- agent arm: restraint-first, lower spend, slightly lower recovery -----
  const agentRecoveryRate = round3(baselineRecoveryRate - 0.018)
  const agentRecoveredPaise = Math.round(valueAtRiskPaise * agentRecoveryRate)
  const agentSpendPaise = Math.round(baselineSpendPaise * 0.59) + randInt(rng, -3000, 3000)
  const agentNetPaise = Math.round(agentRecoveredPaise * marginRate) - agentSpendPaise
  const agentHolds = Math.round(events * 0.335)
  const agent: ArmMetrics = {
    events,
    value_at_risk_paise: valueAtRiskPaise,
    recovered_paise: agentRecoveredPaise,
    spend_paise: agentSpendPaise,
    net_profit_paise: agentNetPaise,
    incremental_profit_paise: jitterInt(rng, Math.round(agentNetPaise * 0.66), 5000),
    recovery_rate: agentRecoveryRate,
    actions_taken: events - agentHolds,
    holds: agentHolds,
    margin_protected_paise: jitterInt(rng, 2_210_400, 4000),
    optouts: 11,
    messages_sent: 612,
  }

  // --- holdout arm: pure control, zero intervention -------------------------
  const holdoutRecoveryRate = round3(0.3 + rng() * 0.01)
  const holdoutRecoveredPaise = Math.round(valueAtRiskPaise * holdoutRecoveryRate)
  const holdout: ArmMetrics = {
    events,
    value_at_risk_paise: valueAtRiskPaise,
    recovered_paise: holdoutRecoveredPaise,
    spend_paise: 0,
    net_profit_paise: Math.round(holdoutRecoveredPaise * marginRate),
    incremental_profit_paise: 0,
    recovery_rate: holdoutRecoveryRate,
    actions_taken: 0,
    holds: 0,
    margin_protected_paise: 0,
    optouts: 0,
    messages_sent: 0,
  }

  const deltaPaise = agent.net_profit_paise - baseline.net_profit_paise
  const deltaPct = round3(agent.net_profit_paise / baseline.net_profit_paise - 1)
  const spendReductionPct = round3(1 - agent.spend_paise / baseline.spend_paise)
  const recoveryRateDelta = round3(agent.recovery_rate - baseline.recovery_rate)

  const series = Array.from({ length: 30 }, (_, i) => {
    const day = i + 1
    const frac = day / 30
    return {
      sim_day: day,
      agent_net_paise: jitterInt(rng, Math.round(agent.net_profit_paise * frac), 4000),
      baseline_net_paise: jitterInt(rng, Math.round(baseline.net_profit_paise * frac), 4000),
      holdout_net_paise: jitterInt(rng, Math.round(holdout.net_profit_paise * frac), 2500),
    }
  })

  const qiniPoints = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0].map((fraction) => ({
    fraction,
    agent: round3(Math.min(1, fraction + (0.21 - 0.1) * (1 - fraction) * 2.1)),
    random: fraction,
  }))

  const calibration = [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65].map((predicted) => ({
    predicted,
    observed: round3(Math.max(0, Math.min(1, predicted + (rng() - 0.5) * 0.02))),
    n: randInt(rng, 40, 140),
  }))

  return {
    run_id: runId,
    arms: { agent, baseline, holdout },
    deltas: {
      net_profit_vs_baseline_paise: deltaPaise,
      net_profit_vs_baseline_pct: deltaPct,
      spend_reduction_pct: spendReductionPct,
      recovery_rate_delta: recoveryRateDelta,
    },
    series,
    qini: { coefficient: 0.187, points: qiniPoints },
    calibration,
  }
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
