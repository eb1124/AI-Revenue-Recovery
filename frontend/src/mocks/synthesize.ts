import type { Action, Candidate, CaseDetail, CaseListItem, WatchlistDetail, WatchlistEntry } from '../api/schemas'

// Fallback generators for records the fixture set doesn't cover in full depth:
// only 12 of the 200 cases.json rows have a hand-authored CaseDetail
// (case-details.json), and watchlist.json entries don't carry the extra
// score-timeline/signal fields WatchlistDetail needs. These synthesize a
// schema-valid, plausible-looking record on demand rather than 404ing, so
// every row in the Cases/Watchlist tables is clickable.
//
// Deliberately deterministic (seeded off the record's own id), not
// Math.random() — so re-opening the same case twice in a session shows the
// same numbers.

function hash01(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

const ACTIONS: Action[] = ['HOLD', 'RETRY_NOW', 'RETRY_SCHEDULED', 'NUDGE_FREE', 'NUDGE_INCENTIVE', 'ESCALATE_HUMAN']
const DIRECT_COST_PAISE: Record<Action, number> = {
  HOLD: 0,
  RETRY_NOW: 200,
  RETRY_SCHEDULED: 200,
  NUDGE_FREE: 35,
  NUDGE_INCENTIVE: 35,
  ESCALATE_HUMAN: 8500,
}

export function synthesizeNarrative(item: CaseListItem): string {
  const cause = item.cause_code.replace(/_/g, ' ')
  const kind = item.kind === 'abandoned_checkout' ? 'checkout' : 'renewal'
  const amount = `₹${Math.round(item.value_at_risk_paise / 100).toLocaleString('en-IN')}`
  return `${cause[0].toUpperCase()}${cause.slice(1)} on a ${kind} worth ${amount}. ${item.headline}`
}

function buildCandidates(item: CaseListItem): Candidate[] {
  const seed = hash01(item.id)
  const marginRate = 0.22
  const chosen = item.decision.action

  const rows = ACTIONS.map((action, i) => {
    const direct_cost_paise = DIRECT_COST_PAISE[action]
    const isChosen = action === chosen
    let ev_paise: number
    if (action === 'HOLD') {
      ev_paise = chosen === 'HOLD' ? 0 : -Math.round(200 + seed * 3000 + i * 137)
    } else if (isChosen) {
      ev_paise = Math.max(600, Math.round(item.value_at_risk_paise * (0.03 + seed * 0.05)))
    } else {
      ev_paise = -Math.round(direct_cost_paise * 2 + 150 + i * 211)
    }
    const uplift = action === 'HOLD' ? 0 : Math.round((0.01 + seed * 0.08) * 1000) / 1000
    const gross_gain_paise = action === 'HOLD' ? 0 : Math.round(uplift * item.value_at_risk_paise * marginRate)
    return {
      action,
      p_recover: Math.min(0.95, Math.max(0.02, 0.3 + (isChosen ? uplift : 0))),
      uplift,
      gross_gain_paise,
      direct_cost_paise,
      incentive_cost_paise: action === 'NUDGE_INCENTIVE' ? Math.round(item.value_at_risk_paise * 0.08) : 0,
      annoyance_cost_paise: action === 'HOLD' ? 0 : Math.round(direct_cost_paise * 1.5),
      farming_cost_paise: 0,
      ev_paise,
      allowed: true,
      block_reason: null,
    }
  })

  const sorted = [...rows].sort((a, b) => b.ev_paise - a.ev_paise)
  const rankOf = new Map(sorted.map((r, i) => [r.action, i + 1]))

  return rows.map((r) => {
    const spread = Math.max(200, Math.round(Math.abs(r.ev_paise) * 0.3) + 150)
    return {
      ...r,
      p_recover: Math.round(r.p_recover * 1000) / 1000,
      ci_low_paise: r.ev_paise - spread,
      ci_high_paise: r.ev_paise + spread,
      rank: rankOf.get(r.action)!,
    }
  })
}

export function synthesizeCaseDetail(item: CaseListItem): CaseDetail {
  const seed = hash01(item.id)
  const resolved = item.outcome.resolution_path === 'self_recovered' || item.outcome.resolution_path === 'agent_recovered'

  return {
    event: item,
    customer_context: {
      tenure_days: Math.round(30 + seed * 1200),
      ltv_expected_paise: Math.round(item.value_at_risk_paise * (4 + seed * 10)),
      gross_margin_bps: 2200,
      abandon_rate_90d: Math.round((0.1 + seed * 0.3) * 1000) / 1000,
      messages_received_7d: 0,
      inferred_salary_day: null,
      farming_score: item.customer.farming_tier === 'flagged' ? 0.7 : item.customer.farming_tier === 'watch' ? 0.5 : Math.round(seed * 0.3 * 1000) / 1000,
      farming_signals: {
        abandon_rate: Math.round(seed * 1000) / 1000,
        post_incentive_conversion: Math.round(((seed * 7) % 1) * 1000) / 1000,
        incentive_dependency: Math.round(((seed * 13) % 1) * 1000) / 1000,
        timing_regularity: Math.round(((seed * 17) % 1) * 1000) / 1000,
        stage_consistency: Math.round(((seed * 23) % 1) * 1000) / 1000,
      },
      recent_events: [],
    },
    diagnosis: {
      cause_code: item.cause_code,
      confidence: item.cause_confidence,
      narrative: synthesizeNarrative(item),
      evidence: [],
    },
    scoring: {
      p_baseline: Math.round((0.15 + seed * 0.4) * 1000) / 1000,
      p_baseline_ci: [Math.round((0.1 + seed * 0.3) * 100) / 100, Math.round((0.3 + seed * 0.4) * 100) / 100],
      model_version: 'p_baseline@mock',
      top_features: [{ name: `cause_code=${item.cause_code}`, contribution: Math.round((0.15 + seed * 0.2) * 100) / 100 }],
    },
    candidates: buildCandidates(item),
    decision: {
      chosen_action: item.decision.action,
      reason_code: item.decision.reason_code,
      decided_by: 'engine',
      latency_ms: Math.round(15 + seed * 60),
      explanation: item.headline,
      blocked_actions: [],
    },
    actions: [],
    messages: [],
    outcome: {
      resolution_path: item.outcome.resolution_path,
      recovered_paise: resolved ? item.value_at_risk_paise : 0,
      total_cost_paise: DIRECT_COST_PAISE[item.decision.action],
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: item.decision.action === 'HOLD' && resolved ? item.value_at_risk_paise : 0,
      incremental_profit_paise: item.decision.action === 'HOLD' ? 0 : item.outcome.net_profit_paise,
      resolved_at_sim: item.detected_at_sim,
    },
    audit_trail: [
      { stage: 'detect', summary: 'Risk event detected.', sim_time: item.detected_at_sim, actor: 'engine' },
      { stage: 'decide', summary: item.headline, sim_time: item.detected_at_sim, actor: 'engine' },
    ],
  }
}

export function synthesizeWatchlistDetail(entry: WatchlistEntry): WatchlistDetail {
  const seed = hash01(entry.customer_id)
  const steps = 6
  const score_timeline = Array.from({ length: steps }, (_, i) => {
    const frac = (i + 1) / steps
    return {
      at: new Date(Date.UTC(2026, 7, 23) + i * 4 * 86400000).toISOString(),
      score: Math.round(Math.max(0.02, entry.farming_score * frac + (seed - 0.5) * 0.05) * 1000) / 1000,
    }
  })

  return {
    ...entry,
    score_timeline,
    farming_signals: {
      abandon_rate: Math.min(1, Math.round((entry.abandons / Math.max(1, entry.checkouts_observed)) * 1000) / 1000),
      post_incentive_conversion: Math.round((0.3 + seed * 0.6) * 1000) / 1000,
      incentive_dependency: Math.round((0.2 + seed * 0.6) * 1000) / 1000,
      timing_regularity: Math.round((0.2 + ((seed * 11) % 1) * 0.6) * 1000) / 1000,
      stage_consistency: Math.round((0.2 + ((seed * 19) % 1) * 0.6) * 1000) / 1000,
    },
    events: [],
  }
}
