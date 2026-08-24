import type {
  CaseAction,
  CaseDetail,
  CaseListItem,
  CaseMessage,
  Channel,
  Evidence,
  Language,
  RecentEvent,
  Tone,
} from '../../src/api/schemas'
import {
  DIRECT_COST_PAISE,
  type GeneratedCustomer,
  buildCandidateTable,
  generateCustomer,
  round3,
} from './build'
import { makeIdFactory } from './ids'
import { fill, MESSAGE_TEMPLATES } from './pools'
import { type Rng, isoAddSeconds, randFloat, randInt } from './rng'

export interface CuratedCase {
  item: CaseListItem
  detail: CaseDetail
}

interface CustomerOverride {
  display_name?: string
  city?: string
  farming_tier?: GeneratedCustomer['farming_tier']
  farming_score?: number
  segment?: GeneratedCustomer['segment']
  preferred_language?: Language
  tenure_days?: number
  ltv_expected_paise?: number
  gross_margin_bps?: number
  abandon_rate_90d?: number
  inferred_salary_day?: number | null
}

function customerWith(rng: Rng, idf: ReturnType<typeof makeIdFactory>, overrides: CustomerOverride): GeneratedCustomer {
  const base = generateCustomer(rng, idf)
  return { ...base, ...overrides }
}

function messageFor(
  idf: ReturnType<typeof makeIdFactory>,
  actionId: string,
  opts: {
    template: 'nudge_free_reminder' | 'nudge_free_update_card' | 'nudge_incentive'
    language: Language
    channel: Channel
    tone: Tone
    name: string
    amountPaise: number
    incentiveRupees?: number
    sentAtSim: string
  },
): CaseMessage {
  const body = fill(MESSAGE_TEMPLATES[opts.language][opts.template][0], {
    name: opts.name.split(' ')[0],
    amount: `₹${Math.round(opts.amountPaise / 100).toLocaleString('en-IN')}`,
    incentive: String(opts.incentiveRupees ?? ''),
    link: 'hold.app/r/8f2k',
  })
  return {
    id: idf('msg'),
    action_id: actionId,
    channel: opts.channel,
    language: opts.language,
    body,
    incentive_bps: opts.template === 'nudge_incentive' ? Math.round((opts.incentiveRupees! * 100 * 10000) / opts.amountPaise) : 0,
    tone: opts.tone,
    policy_checks_passed: [
      { rule: 'no_urgency_pressure', passed: opts.tone !== 'urgent' },
      { rule: 'no_third_party_mention', passed: true },
      { rule: 'under_320_chars', passed: body.length < 320 },
    ],
    sent_at_sim: opts.sentAtSim,
    opened: Math.random() < 0.6,
    clicked: Math.random() < 0.3,
  }
}

function auditTrail(
  detectedAtSim: string,
  entries: { stage: CaseDetail['audit_trail'][number]['stage']; summary: string; actor: CaseDetail['audit_trail'][number]['actor']; offsetSeconds: number }[],
): CaseDetail['audit_trail'] {
  return entries.map((e) => ({
    stage: e.stage,
    summary: e.summary,
    sim_time: isoAddSeconds(detectedAtSim, e.offsetSeconds),
    actor: e.actor,
  }))
}

// ===========================================================================
// Scenario 1 — clean HOLD on upi_timeout with self-recovery.
// Narrative text (diagnosis/evidence/explanation) is copied verbatim from the
// worked example in spec section 8.4 (customer "Meera Raghavan"); the EV
// table is generated via buildCandidateTable rather than the spec's partial
// (2-of-6-row) example, so all six rows are arithmetically consistent.
// ===========================================================================
function scenarioCleanHold(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Meera Raghavan',
    city: 'Chennai',
    segment: 'regular',
    farming_tier: 'normal',
    farming_score: 0.19,
    tenure_days: 412,
    ltv_expected_paise: 2840000,
    gross_margin_bps: 2200,
    abandon_rate_90d: 0.31,
    inferred_salary_day: 28,
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 340000
  const causeCode = 'upi_timeout' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'HOLD',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
    holdReason: 'no_action_beats_hold',
  })

  const eventId = idf('evt')
  const item: CaseListItem = {
    id: eventId,
    customer: {
      id: customer.id,
      display_name: customer.display_name,
      segment: customer.segment,
      farming_tier: customer.farming_tier,
      city: customer.city,
    },
    kind: 'abandoned_checkout',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: 0.86,
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'HOLD', reason_code: 'no_action_beats_hold', best_ev_paise: 0, margin_protected_paise: 34000 },
    outcome: { resolution_path: 'self_recovered', net_profit_paise: 74800 },
    detected_at_sim: detectedAtSim,
    headline: 'Returned on their own in 3h 12m. We spent nothing.',
  }

  const resolvedAtSim = isoAddSeconds(detectedAtSim, 3 * 3600 + 12 * 60 + 4)

  const recent_events: RecentEvent[] = [
    { id: idf('evt'), kind: 'abandoned_checkout', outcome: 'self_recovered', at: isoAddSeconds(detectedAtSim, -18 * 86400) },
    { id: idf('evt'), kind: 'abandoned_checkout', outcome: 'self_recovered', at: isoAddSeconds(detectedAtSim, -41 * 86400) },
  ]

  const evidence: Evidence[] = [
    { signal: 'gateway_upi_success_rate_1h', value: '71%', weight: 0.34 },
    { signal: 'prior_self_recoveries', value: '2', weight: 0.22 },
  ]

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 0,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events,
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: 0.86,
      narrative:
        'UPI collect request timed out at 14:32. This customer has timed out twice before and completed payment within four hours both times.',
      evidence,
    },
    scoring: {
      p_baseline: 0.61,
      p_baseline_ci: [0.54, 0.68],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [
        { name: 'cause_code=upi_timeout', contribution: 0.28 },
        { name: 'prior_self_recoveries', contribution: 0.19 },
      ],
    },
    candidates,
    decision: {
      chosen_action: 'HOLD',
      reason_code: 'no_action_beats_hold',
      decided_by: 'engine',
      latency_ms: 34,
      explanation:
        'Every intervention costs more than the margin it would add. This customer recovers on their own 61% of the time after a UPI timeout, and a 10% incentive would buy 13 points of uplift for ₹340 of margin on a ₹3,400 cart worth ₹748 in gross profit.',
      blocked_actions: [],
    },
    actions: [],
    messages: [],
    outcome: {
      resolution_path: 'self_recovered',
      recovered_paise: 340000,
      total_cost_paise: 0,
      net_profit_paise: 74800,
      counterfactual_recovered_paise: 340000,
      incremental_profit_paise: 0,
      resolved_at_sim: resolvedAtSim,
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'payment_initiated with no terminal state for 30 minutes.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'diagnose', summary: 'Classified as upi_timeout, confidence 0.86.', actor: 'llm', offsetSeconds: 4 },
      { stage: 'score', summary: 'p_baseline=0.61, CI [0.54, 0.68].', actor: 'engine', offsetSeconds: 9 },
      { stage: 'decide', summary: 'Chose HOLD — no action beats doing nothing.', actor: 'engine', offsetSeconds: 34 },
      { stage: 'verify', summary: 'Customer self-recovered 3h 12m after detection.', actor: 'simulator', offsetSeconds: 3 * 3600 + 12 * 60 + 4 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 2 — a message survives a policy block, sent in Hinglish.
// NUDGE_INCENTIVE is capped by the "max 1 message / 24h" policy (this
// customer was already contacted earlier the same sim-day); the engine falls
// back to NUDGE_FREE, which is allowed and positive-EV.
// ===========================================================================
function scenarioPolicyBlockedFallback(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Rahul Verma',
    city: 'Delhi',
    segment: 'casual',
    farming_tier: 'normal',
    farming_score: 0.24,
    preferred_language: 'hinglish',
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 118000
  const causeCode = 'do_not_honour' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'NUDGE_FREE',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
    blockedActions: { NUDGE_INCENTIVE: 'Blocked by policy: Maximum 1 message per customer per 24h.' },
  })

  const eventId = idf('evt')
  const actionId = idf('act')
  const sentAtSim = isoAddSeconds(detectedAtSim, 900)

  const chosen = candidates.find((c) => c.action === 'NUDGE_FREE')!
  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'abandoned_checkout',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.7, 0.9)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'NUDGE_FREE', reason_code: 'positive_ev', best_ev_paise: chosen.ev_paise, margin_protected_paise: 0 },
    outcome: { resolution_path: 'agent_recovered', net_profit_paise: Math.round(valueAtRiskPaise * (customer.gross_margin_bps / 10000)) - 35 },
    detected_at_sim: detectedAtSim,
    headline: 'Recovered after a free reminder — the incentive offer was capped by the 24h contact policy.',
  }

  const message = messageFor(idf, actionId, {
    template: 'nudge_free_reminder',
    language: 'hinglish',
    channel: 'whatsapp',
    tone: 'warm',
    name: customer.display_name,
    amountPaise: valueAtRiskPaise,
    sentAtSim,
  })

  const action: CaseAction = {
    id: actionId,
    decision_id: idf('dec'),
    risk_event_id: eventId,
    type: 'NUDGE_FREE',
    params: { channel: 'whatsapp', language: 'hinglish' },
    scheduled_for_sim: sentAtSim,
    executed_at_sim: sentAtSim,
    status: 'executed',
    cancel_reason: null,
    cost_paise: DIRECT_COST_PAISE.NUDGE_FREE,
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 1,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: candidates[0] ? item.cause_confidence : item.cause_confidence,
      narrative: 'Issuer declined with a generic do-not-honour code. No pattern of prior declines on this instrument.',
      evidence: [{ signal: 'issuer_decline_rate_24h', value: '9%', weight: 0.18 }],
    },
    scoring: {
      p_baseline: 0.11,
      p_baseline_ci: [0.07, 0.16],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'cause_code=do_not_honour', contribution: 0.21 }],
    },
    candidates,
    decision: {
      chosen_action: 'NUDGE_FREE',
      reason_code: 'positive_ev',
      decided_by: 'engine',
      latency_ms: randInt(rng, 20, 60),
      explanation:
        'NUDGE_INCENTIVE had the highest raw EV but was blocked — this customer already received a message in the last 24 hours. NUDGE_FREE is the best remaining allowed action and clears the minimum edge on its own.',
      blocked_actions: [{ action: 'NUDGE_INCENTIVE', policy_id: 'pol_max_1_message_24h', policy_name: 'Maximum 1 message per customer per 24h' }],
    },
    actions: [action],
    messages: [message],
    outcome: {
      resolution_path: 'agent_recovered',
      recovered_paise: valueAtRiskPaise,
      total_cost_paise: DIRECT_COST_PAISE.NUDGE_FREE,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: 0,
      incremental_profit_paise: item.outcome.net_profit_paise,
      resolved_at_sim: isoAddSeconds(sentAtSim, 1800),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Issuer decline, do_not_honour.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'policy', summary: 'NUDGE_INCENTIVE blocked: max 1 message / 24h already used.', actor: 'engine', offsetSeconds: 6 },
      { stage: 'decide', summary: 'Chose NUDGE_FREE — best allowed action.', actor: 'engine', offsetSeconds: 12 },
      { stage: 'act', summary: 'Sent WhatsApp reminder in Hinglish.', actor: 'engine', offsetSeconds: 900 },
      { stage: 'verify', summary: 'Payment completed 30 minutes after the message.', actor: 'simulator', offsetSeconds: 2700 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 3 — flagged farmer cut off. Ties to the "Rohit Menon" character
// used in watchlist.json and the demo script (section 13).
// ===========================================================================
function scenarioFlaggedFarmerCutoff(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string, rohitId: string): CuratedCase {
  const customer: GeneratedCustomer = {
    ...generateCustomer(rng, idf),
    id: rohitId,
    display_name: 'Rohit Menon',
    city: 'Kochi',
    segment: 'regular',
    farming_tier: 'flagged',
    farming_score: 0.71,
  }
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 214000
  const causeCode = 'upi_timeout' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'HOLD',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
    holdReason: 'no_action_beats_hold',
    blockedActions: { NUDGE_INCENTIVE: 'Blocked by policy: No incentives to flagged farmers.' },
  })

  const eventId = idf('evt')
  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'abandoned_checkout',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.6, 0.85)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'HOLD', reason_code: 'no_action_beats_hold', best_ev_paise: 0, margin_protected_paise: Math.round(valueAtRiskPaise * 0.14) },
    outcome: { resolution_path: 'lost', net_profit_paise: 0 },
    detected_at_sim: detectedAtSim,
    headline: 'Flagged farmer (score 0.71) — incentive withheld. Cut off at ₹0 cost.',
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: 0.58,
      messages_received_7d: 3,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: 0.71,
      farming_signals: {
        abandon_rate: 0.62,
        post_incentive_conversion: 0.91,
        incentive_dependency: 0.74,
        timing_regularity: 0.68,
        stage_consistency: 0.55,
      },
      recent_events: [
        { id: idf('evt'), kind: 'abandoned_checkout', outcome: 'agent_recovered', at: isoAddSeconds(detectedAtSim, -6 * 86400) },
        { id: idf('evt'), kind: 'abandoned_checkout', outcome: 'agent_recovered', at: isoAddSeconds(detectedAtSim, -13 * 86400) },
        { id: idf('evt'), kind: 'abandoned_checkout', outcome: 'agent_recovered', at: isoAddSeconds(detectedAtSim, -20 * 86400) },
      ],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative:
        'UPI timeout, but the pattern underneath is different from a typical timeout case: 9 of his last 11 abandonments converted within 30 minutes of receiving an incentive. That is a learned response, not friction.',
      evidence: [
        { signal: 'post_incentive_conversion_rate', value: '91%', weight: 0.3 },
        { signal: 'incentive_dependency', value: '74%', weight: 0.2 },
      ],
    },
    scoring: {
      p_baseline: 0.34,
      p_baseline_ci: [0.26, 0.43],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [
        { name: 'farming_score', contribution: 0.31 },
        { name: 'post_incentive_conversion_rate', contribution: 0.24 },
      ],
    },
    candidates,
    decision: {
      chosen_action: 'HOLD',
      reason_code: 'no_action_beats_hold',
      decided_by: 'engine',
      latency_ms: randInt(rng, 25, 55),
      explanation:
        'This customer’s farming score crossed 0.65 this run. NUDGE_INCENTIVE is removed from the action set entirely for flagged farmers, and every remaining action costs more than the margin it would add. We hold, and pay nothing.',
      blocked_actions: [{ action: 'NUDGE_INCENTIVE', policy_id: 'pol_no_incentive_flagged_farmer', policy_name: 'No incentives to flagged farmers' }],
    },
    actions: [],
    messages: [],
    outcome: {
      resolution_path: 'lost',
      recovered_paise: 0,
      total_cost_paise: 0,
      net_profit_paise: 0,
      counterfactual_recovered_paise: 0,
      incremental_profit_paise: 0,
      resolved_at_sim: isoAddSeconds(detectedAtSim, 14 * 86400),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'payment_initiated with no terminal state for 30 minutes.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'policy', summary: 'farming_tier=flagged (score 0.71) — NUDGE_INCENTIVE removed from candidate set.', actor: 'engine', offsetSeconds: 5 },
      { stage: 'decide', summary: 'Chose HOLD — every remaining action is negative EV.', actor: 'engine', offsetSeconds: 22 },
      { stage: 'verify', summary: 'No further contact; event expired unresolved after 14 sim-days.', actor: 'simulator', offsetSeconds: 14 * 86400 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 4 — high-value escalation.
// ===========================================================================
function scenarioHighValueEscalation(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Anjali Krishnan',
    city: 'Bengaluru',
    segment: 'power',
    farming_tier: 'normal',
    farming_score: 0.11,
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 3180000 // ₹31,800 — above the ₹25,000 human-approval threshold
  const causeCode = 'risk_declined' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'ESCALATE_HUMAN',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
  })

  const eventId = idf('evt')
  const actionId = idf('act')
  const chosen = candidates.find((c) => c.action === 'ESCALATE_HUMAN')!
  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'failed_renewal',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.55, 0.75)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'ESCALATE_HUMAN', reason_code: 'high_value_ambiguous', best_ev_paise: chosen.ev_paise, margin_protected_paise: 0 },
    outcome: { resolution_path: 'agent_recovered', net_profit_paise: Math.round(valueAtRiskPaise * (customer.gross_margin_bps / 10000)) - DIRECT_COST_PAISE.ESCALATE_HUMAN },
    detected_at_sim: detectedAtSim,
    headline: 'Routed to a human — ₹31,800 renewal flagged as possible fraud, above the ₹25,000 threshold.',
  }

  const action: CaseAction = {
    id: actionId,
    decision_id: idf('dec'),
    risk_event_id: eventId,
    type: 'ESCALATE_HUMAN',
    params: { queue: 'high_value_review' },
    scheduled_for_sim: detectedAtSim,
    executed_at_sim: isoAddSeconds(detectedAtSim, 1200),
    status: 'executed',
    cancel_reason: null,
    cost_paise: DIRECT_COST_PAISE.ESCALATE_HUMAN,
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 0,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative:
        'Renewal declined with a risk flag from the issuer, on a plan worth ₹31,800. The confidence interval on recovery is wide enough, and the value large enough, that this should not be resolved by formula alone.',
      evidence: [{ signal: 'issuer_risk_flag', value: 'present', weight: 0.4 }],
    },
    scoring: {
      p_baseline: 0.31,
      p_baseline_ci: [0.14, 0.49],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'cause_code=risk_declined', contribution: 0.33 }],
    },
    candidates,
    decision: {
      chosen_action: 'ESCALATE_HUMAN',
      reason_code: 'high_value_ambiguous',
      decided_by: 'engine',
      latency_ms: randInt(rng, 30, 70),
      explanation:
        'Value at risk is ₹31,800, above the ₹25,000 threshold for automatic action, and the recovery confidence interval straddles a wide range. Policy 10 routes this to a human for review rather than acting automatically.',
      blocked_actions: [],
    },
    actions: [action],
    messages: [],
    outcome: {
      resolution_path: 'agent_recovered',
      recovered_paise: valueAtRiskPaise,
      total_cost_paise: DIRECT_COST_PAISE.ESCALATE_HUMAN,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: 0,
      incremental_profit_paise: item.outcome.net_profit_paise,
      resolved_at_sim: isoAddSeconds(detectedAtSim, 3 * 3600),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Renewal declined, risk_declined, ₹31,800 at risk.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'policy', summary: 'Value above ₹25,000 — human approval required.', actor: 'engine', offsetSeconds: 8 },
      { stage: 'decide', summary: 'Routed to ESCALATE_HUMAN.', actor: 'engine', offsetSeconds: 22 },
      { stage: 'act', summary: 'Queued for human review.', actor: 'engine', offsetSeconds: 1200 },
      { stage: 'verify', summary: 'Analyst confirmed the card and renewal completed.', actor: 'human', offsetSeconds: 3 * 3600 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 5 — a scheduled retry cancelled because the customer self-recovered first.
// ===========================================================================
function scenarioCancelledRetry(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Suresh Nair',
    city: 'Thiruvananthapuram',
    segment: 'regular',
    farming_tier: 'normal',
    farming_score: 0.15,
    inferred_salary_day: 1,
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 24 * 86400))
  const valueAtRiskPaise = 890000 // renewal MRR-scale
  const causeCode = 'insufficient_funds' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'RETRY_SCHEDULED',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
  })

  const eventId = idf('evt')
  const actionId = idf('act')
  const chosen = candidates.find((c) => c.action === 'RETRY_SCHEDULED')!
  const scheduledFor = isoAddSeconds(detectedAtSim, 6 * 86400) // next salary day
  const selfRecoveredAt = isoAddSeconds(detectedAtSim, 3 * 86400 + 3600 * 5)

  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'failed_renewal',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.75, 0.93)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'RETRY_SCHEDULED', reason_code: 'positive_ev', best_ev_paise: chosen.ev_paise, margin_protected_paise: 0 },
    outcome: { resolution_path: 'self_recovered', net_profit_paise: Math.round(valueAtRiskPaise * (customer.gross_margin_bps / 10000)) },
    detected_at_sim: detectedAtSim,
    headline: 'Paid on their own 3 days later — the scheduled retry was cancelled before it fired.',
  }

  const action: CaseAction = {
    id: actionId,
    decision_id: idf('dec'),
    risk_event_id: eventId,
    type: 'RETRY_SCHEDULED',
    params: { scheduled_for_sim: scheduledFor, gateway: 'razorpay' },
    scheduled_for_sim: scheduledFor,
    executed_at_sim: null,
    status: 'cancelled',
    cancel_reason: 'Customer paid manually before the scheduled retry executed.',
    cost_paise: 0,
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 0,
      inferred_salary_day: 1,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative:
        'Renewal declined for insufficient funds two days before this customer’s inferred salary date (the 1st of the month). Retrying now would likely fail again; scheduling for the salary window is the higher-odds move.',
      evidence: [{ signal: 'inferred_salary_day', value: '1', weight: 0.31 }],
    },
    scoring: {
      p_baseline: SELF_RECOVERY_PLACEHOLDER,
      p_baseline_ci: [0.16, 0.29],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'days_to_inferred_salary_day', contribution: 0.27 }],
    },
    candidates,
    decision: {
      chosen_action: 'RETRY_SCHEDULED',
      reason_code: 'positive_ev',
      decided_by: 'engine',
      latency_ms: randInt(rng, 20, 50),
      explanation: 'Scheduling the retry for the customer’s inferred salary date clears the minimum edge with room to spare.',
      blocked_actions: [],
    },
    actions: [action],
    messages: [],
    outcome: {
      resolution_path: 'self_recovered',
      recovered_paise: valueAtRiskPaise,
      total_cost_paise: 0,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: valueAtRiskPaise,
      incremental_profit_paise: 0,
      resolved_at_sim: selfRecoveredAt,
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Renewal declined, insufficient_funds.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'decide', summary: 'Scheduled retry for inferred salary date (+6d).', actor: 'engine', offsetSeconds: 18 },
      { stage: 'act', summary: 'Retry scheduled for salary window.', actor: 'engine', offsetSeconds: 30 },
      { stage: 'verify', summary: 'Customer paid manually 3 days in — scheduled retry cancelled.', actor: 'simulator', offsetSeconds: 3 * 86400 + 3600 * 5 },
    ]),
  }

  return { item, detail }
}
const SELF_RECOVERY_PLACEHOLDER = 0.22 // insufficient_funds self-recovery rate, section 6.3

// ===========================================================================
// Scenario 6 — human override.
// ===========================================================================
function scenarioHumanOverride(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Farhan Sheikh',
    city: 'Lucknow',
    segment: 'new',
    farming_tier: 'normal',
    farming_score: 0.08,
    preferred_language: 'en',
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 62000
  const causeCode = 'card_limit_exceeded' as const

  // Engine's own read of the world: HOLD wins narrowly (low value, thin edge).
  const candidates = buildCandidateTable(rng, {
    chosenAction: 'HOLD',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
    holdReason: 'edge_too_thin',
  })

  const eventId = idf('evt')
  const actionId = idf('act')
  const overrodeAt = isoAddSeconds(detectedAtSim, 5400)

  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'abandoned_checkout',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.65, 0.85)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'NUDGE_FREE', reason_code: 'positive_ev', best_ev_paise: 190, margin_protected_paise: 0 },
    outcome: { resolution_path: 'agent_recovered', net_profit_paise: Math.round(valueAtRiskPaise * (customer.gross_margin_bps / 10000)) - 35 },
    detected_at_sim: detectedAtSim,
    headline: 'This customer’s first order — an ops analyst sent a reminder anyway, and it worked.',
  }

  const message = messageFor(idf, actionId, {
    template: 'nudge_free_reminder',
    language: 'en',
    channel: 'email',
    tone: 'warm',
    name: customer.display_name,
    amountPaise: valueAtRiskPaise,
    sentAtSim: overrodeAt,
  })

  const action: CaseAction = {
    id: actionId,
    decision_id: idf('dec'),
    risk_event_id: eventId,
    type: 'NUDGE_FREE',
    params: { channel: 'email', language: 'en', override: true },
    scheduled_for_sim: overrodeAt,
    executed_at_sim: overrodeAt,
    status: 'executed',
    cancel_reason: null,
    cost_paise: DIRECT_COST_PAISE.NUDGE_FREE,
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 0,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative: 'Card limit exceeded on a first-time customer’s very first order. No history to score against.',
      evidence: [{ signal: 'customer_tenure_days', value: '3', weight: 0.25 }],
    },
    scoring: {
      p_baseline: 0.19,
      p_baseline_ci: [0.09, 0.31],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'tenure_days', contribution: 0.22 }],
    },
    candidates,
    decision: {
      chosen_action: 'NUDGE_FREE',
      reason_code: 'positive_ev',
      decided_by: 'human_override',
      latency_ms: 0,
      explanation:
        'Engine recommended HOLD — the model edge was below the ₹5 minimum on a cold-start customer with no history. An ops analyst overrode it: first-order customers are worth a free nudge even at thin model confidence, since a bad first experience is costly beyond this one order.',
      blocked_actions: [],
    },
    actions: [action],
    messages: [message],
    outcome: {
      resolution_path: 'agent_recovered',
      recovered_paise: valueAtRiskPaise,
      total_cost_paise: DIRECT_COST_PAISE.NUDGE_FREE,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: 0,
      incremental_profit_paise: item.outcome.net_profit_paise,
      resolved_at_sim: isoAddSeconds(overrodeAt, 2400),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Card limit exceeded on first order.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'decide', summary: 'Engine chose HOLD — edge too thin (cold start, no history).', actor: 'engine', offsetSeconds: 15 },
      { stage: 'override', summary: 'Human override: send NUDGE_FREE regardless — first-order customer.', actor: 'human', offsetSeconds: 5400 },
      { stage: 'act', summary: 'Sent email reminder.', actor: 'engine', offsetSeconds: 5401 },
      { stage: 'verify', summary: 'Customer completed payment 40 minutes later.', actor: 'simulator', offsetSeconds: 5400 + 2400 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 7 — NUDGE_INCENTIVE approved for a genuinely price-sensitive
// customer. Message written in Tamil-English (Tanglish).
// ===========================================================================
function scenarioIncentiveApproved(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Saranya Murugan',
    city: 'Coimbatore',
    segment: 'casual',
    farming_tier: 'normal',
    farming_score: 0.21,
    preferred_language: 'ta',
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 156000
  const causeCode = 'do_not_honour' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'NUDGE_INCENTIVE',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
  })

  const eventId = idf('evt')
  const actionId = idf('act')
  const sentAtSim = isoAddSeconds(detectedAtSim, 1200)
  const chosen = candidates.find((c) => c.action === 'NUDGE_INCENTIVE')!
  const incentiveRupees = Math.round((valueAtRiskPaise * 800) / 10000 / 100) // 8%

  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'abandoned_checkout',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.68, 0.88)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'NUDGE_INCENTIVE', reason_code: 'positive_ev', best_ev_paise: chosen.ev_paise, margin_protected_paise: 0 },
    outcome: {
      resolution_path: 'agent_recovered',
      net_profit_paise: Math.round(valueAtRiskPaise * (customer.gross_margin_bps / 10000)) - 35 - incentiveRupees * 100,
    },
    detected_at_sim: detectedAtSim,
    headline: `Recovered after an 8% incentive — genuinely price-sensitive, not a repeat pattern.`,
  }

  const message = messageFor(idf, actionId, {
    template: 'nudge_incentive',
    language: 'ta',
    channel: 'whatsapp',
    tone: 'warm',
    name: customer.display_name,
    amountPaise: valueAtRiskPaise,
    incentiveRupees,
    sentAtSim,
  })

  const action: CaseAction = {
    id: actionId,
    decision_id: idf('dec'),
    risk_event_id: eventId,
    type: 'NUDGE_INCENTIVE',
    params: { channel: 'whatsapp', language: 'ta', incentive_bps: 800 },
    scheduled_for_sim: sentAtSim,
    executed_at_sim: sentAtSim,
    status: 'executed',
    cancel_reason: null,
    cost_paise: DIRECT_COST_PAISE.NUDGE_INCENTIVE + incentiveRupees * 100,
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 0,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative:
        'Issuer decline with no retry pattern. This customer has never received an incentive before and their abandon-to-convert timing is irregular — the opposite of a learned farming pattern.',
      evidence: [{ signal: 'incentive_dependency', value: '5%', weight: 0.17 }],
    },
    scoring: {
      p_baseline: 0.11,
      p_baseline_ci: [0.06, 0.18],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'incentive_dependency', contribution: 0.15 }],
    },
    candidates,
    decision: {
      chosen_action: 'NUDGE_INCENTIVE',
      reason_code: 'positive_ev',
      decided_by: 'engine',
      latency_ms: randInt(rng, 25, 60),
      explanation: 'The smallest incentive that clears positive EV is 8%. Farming signals are low, so the incentive cost is genuinely incremental spend, not a discount being farmed.',
      blocked_actions: [],
    },
    actions: [action],
    messages: [message],
    outcome: {
      resolution_path: 'agent_recovered',
      recovered_paise: valueAtRiskPaise,
      total_cost_paise: action.cost_paise,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: 0,
      incremental_profit_paise: item.outcome.net_profit_paise,
      resolved_at_sim: isoAddSeconds(sentAtSim, 3600),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Issuer decline, do_not_honour.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'score', summary: 'Low farming score (0.21) — incentive spend treated as genuine.', actor: 'engine', offsetSeconds: 10 },
      { stage: 'decide', summary: 'Chose NUDGE_INCENTIVE at 8% — smallest incentive clearing positive EV.', actor: 'engine', offsetSeconds: 24 },
      { stage: 'act', summary: 'Sent Tamil WhatsApp message with incentive.', actor: 'engine', offsetSeconds: 1200 },
      { stage: 'verify', summary: 'Payment completed within the hour.', actor: 'simulator', offsetSeconds: 1200 + 3600 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 8 — immediate retry succeeds on a transient bank outage.
// ===========================================================================
function scenarioRetryNowSuccess(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Vikram Deshpande',
    city: 'Pune',
    segment: 'power',
    farming_tier: 'normal',
    farming_score: 0.09,
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 449000
  const causeCode = 'bank_downtime' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'RETRY_NOW',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
  })

  const eventId = idf('evt')
  const actionId = idf('act')
  const chosen = candidates.find((c) => c.action === 'RETRY_NOW')!
  const executedAt = isoAddSeconds(detectedAtSim, 600)

  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'failed_renewal',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.8, 0.96)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'RETRY_NOW', reason_code: 'positive_ev', best_ev_paise: chosen.ev_paise, margin_protected_paise: 0 },
    outcome: { resolution_path: 'agent_recovered', net_profit_paise: Math.round(valueAtRiskPaise * (customer.gross_margin_bps / 10000)) - 200 },
    detected_at_sim: detectedAtSim,
    headline: 'Immediate retry succeeded — bank gateway outage had already cleared.',
  }

  const action: CaseAction = {
    id: actionId,
    decision_id: idf('dec'),
    risk_event_id: eventId,
    type: 'RETRY_NOW',
    params: { gateway: 'payu' },
    scheduled_for_sim: executedAt,
    executed_at_sim: executedAt,
    status: 'executed',
    cancel_reason: null,
    cost_paise: DIRECT_COST_PAISE.RETRY_NOW,
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 0,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative: 'Gateway-side timeout consistent with a known issuer outage window. Historically resolves within minutes.',
      evidence: [{ signal: 'gateway_success_rate_10m', value: '94%', weight: 0.29 }],
    },
    scoring: {
      p_baseline: 0.71,
      p_baseline_ci: [0.63, 0.79],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'cause_code=bank_downtime', contribution: 0.24 }],
    },
    candidates,
    decision: {
      chosen_action: 'RETRY_NOW',
      reason_code: 'positive_ev',
      decided_by: 'engine',
      latency_ms: randInt(rng, 15, 40),
      explanation: 'Gateway success rate has already recovered to 94% in the last 10 minutes. An immediate retry clears positive EV cheaply.',
      blocked_actions: [],
    },
    actions: [action],
    messages: [],
    outcome: {
      resolution_path: 'agent_recovered',
      recovered_paise: valueAtRiskPaise,
      total_cost_paise: DIRECT_COST_PAISE.RETRY_NOW,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: valueAtRiskPaise,
      incremental_profit_paise: -200,
      resolved_at_sim: isoAddSeconds(executedAt, 30),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Renewal failed, bank_downtime.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'decide', summary: 'Chose RETRY_NOW — gateway already recovering.', actor: 'engine', offsetSeconds: 12 },
      { stage: 'act', summary: 'Retried on payu.', actor: 'engine', offsetSeconds: 600 },
      { stage: 'verify', summary: 'Retry succeeded.', actor: 'simulator', offsetSeconds: 630 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 9 — scheduled retry timed to salary day, executes and succeeds.
// ===========================================================================
function scenarioScheduledRetrySuccess(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Geeta Bora',
    city: 'Guwahati',
    segment: 'casual',
    farming_tier: 'normal',
    farming_score: 0.17,
    inferred_salary_day: 7,
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 20 * 86400))
  const valueAtRiskPaise = 61900
  const causeCode = 'insufficient_funds' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'RETRY_SCHEDULED',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
  })

  const eventId = idf('evt')
  const actionId = idf('act')
  const chosen = candidates.find((c) => c.action === 'RETRY_SCHEDULED')!
  const scheduledFor = isoAddSeconds(detectedAtSim, 5 * 86400)

  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'failed_renewal',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.72, 0.9)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'RETRY_SCHEDULED', reason_code: 'positive_ev', best_ev_paise: chosen.ev_paise, margin_protected_paise: 0 },
    outcome: { resolution_path: 'agent_recovered', net_profit_paise: Math.round(valueAtRiskPaise * (customer.gross_margin_bps / 10000)) - 200 },
    detected_at_sim: detectedAtSim,
    headline: 'Retry timed to the 7th (inferred salary day) succeeded on the first attempt.',
  }

  const action: CaseAction = {
    id: actionId,
    decision_id: idf('dec'),
    risk_event_id: eventId,
    type: 'RETRY_SCHEDULED',
    params: { scheduled_for_sim: scheduledFor, gateway: 'cashfree' },
    scheduled_for_sim: scheduledFor,
    executed_at_sim: scheduledFor,
    status: 'executed',
    cancel_reason: null,
    cost_paise: DIRECT_COST_PAISE.RETRY_SCHEDULED,
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 0,
      inferred_salary_day: 7,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative: 'Insufficient funds, five days before this customer’s inferred salary date of the 7th. Retrying now would likely repeat the decline.',
      evidence: [{ signal: 'inferred_salary_day', value: '7', weight: 0.29 }],
    },
    scoring: {
      p_baseline: 0.22,
      p_baseline_ci: [0.15, 0.3],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'days_to_inferred_salary_day', contribution: 0.26 }],
    },
    candidates,
    decision: {
      chosen_action: 'RETRY_SCHEDULED',
      reason_code: 'positive_ev',
      decided_by: 'engine',
      latency_ms: randInt(rng, 20, 45),
      explanation: 'Scheduling for the inferred salary date turns a low-odds immediate retry into a high-odds one.',
      blocked_actions: [],
    },
    actions: [action],
    messages: [],
    outcome: {
      resolution_path: 'agent_recovered',
      recovered_paise: valueAtRiskPaise,
      total_cost_paise: DIRECT_COST_PAISE.RETRY_SCHEDULED,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: 0,
      incremental_profit_paise: item.outcome.net_profit_paise,
      resolved_at_sim: isoAddSeconds(scheduledFor, 120),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Renewal failed, insufficient_funds.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'decide', summary: 'Scheduled retry for inferred salary day (+5d).', actor: 'engine', offsetSeconds: 16 },
      { stage: 'act', summary: 'Retry executed on schedule.', actor: 'engine', offsetSeconds: 5 * 86400 },
      { stage: 'verify', summary: 'Retry succeeded on first attempt.', actor: 'simulator', offsetSeconds: 5 * 86400 + 120 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 10 — expired card, update-link nudge in English ("retrying is
// always wrong" per section 6.3).
// ===========================================================================
function scenarioExpiredCardNudge(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Priya Subramaniam',
    city: 'Hyderabad',
    segment: 'regular',
    farming_tier: 'normal',
    farming_score: 0.13,
    preferred_language: 'en',
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 224000
  const causeCode = 'expired_card' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'NUDGE_FREE',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
    blockedActions: {
      RETRY_NOW: 'Blocked by policy: No retries on expired_card / mandate_revoked.',
      RETRY_SCHEDULED: 'Blocked by policy: No retries on expired_card / mandate_revoked.',
    },
  })

  const eventId = idf('evt')
  const actionId = idf('act')
  const chosen = candidates.find((c) => c.action === 'NUDGE_FREE')!
  const sentAtSim = isoAddSeconds(detectedAtSim, 700)

  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'failed_renewal',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.88, 0.98)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'NUDGE_FREE', reason_code: 'positive_ev', best_ev_paise: chosen.ev_paise, margin_protected_paise: 0 },
    outcome: { resolution_path: 'agent_recovered', net_profit_paise: Math.round(valueAtRiskPaise * (customer.gross_margin_bps / 10000)) - 35 },
    detected_at_sim: detectedAtSim,
    headline: 'Card expired — retries blocked by policy. Sent an update-card link instead.',
  }

  const message = messageFor(idf, actionId, {
    template: 'nudge_free_update_card',
    language: 'en',
    channel: 'email',
    tone: 'neutral',
    name: customer.display_name,
    amountPaise: valueAtRiskPaise,
    sentAtSim,
  })

  const action: CaseAction = {
    id: actionId,
    decision_id: idf('dec'),
    risk_event_id: eventId,
    type: 'NUDGE_FREE',
    params: { channel: 'email', language: 'en', link_type: 'update_card' },
    scheduled_for_sim: sentAtSim,
    executed_at_sim: sentAtSim,
    status: 'executed',
    cancel_reason: null,
    cost_paise: DIRECT_COST_PAISE.NUDGE_FREE,
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 0,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative: 'Card on file expired last month. No retry will succeed against an expired instrument — this needs a new card, not a retry.',
      evidence: [{ signal: 'card_expiry_date', value: 'past', weight: 0.4 }],
    },
    scoring: {
      p_baseline: 0.04,
      p_baseline_ci: [0.01, 0.09],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'cause_code=expired_card', contribution: 0.36 }],
    },
    candidates,
    decision: {
      chosen_action: 'NUDGE_FREE',
      reason_code: 'positive_ev',
      decided_by: 'engine',
      latency_ms: randInt(rng, 15, 35),
      explanation: 'Retrying an expired card can never succeed, so both retry actions are policy-blocked. A free update-card nudge is the only path to recovery and it clears positive EV easily.',
      blocked_actions: [
        { action: 'RETRY_NOW', policy_id: 'pol_no_retry_dead_mandate', policy_name: 'No retries on expired_card / mandate_revoked' },
        { action: 'RETRY_SCHEDULED', policy_id: 'pol_no_retry_dead_mandate', policy_name: 'No retries on expired_card / mandate_revoked' },
      ],
    },
    actions: [action],
    messages: [message],
    outcome: {
      resolution_path: 'agent_recovered',
      recovered_paise: valueAtRiskPaise,
      total_cost_paise: DIRECT_COST_PAISE.NUDGE_FREE,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: 0,
      incremental_profit_paise: item.outcome.net_profit_paise,
      resolved_at_sim: isoAddSeconds(sentAtSim, 5400),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Renewal failed, expired_card.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'policy', summary: 'RETRY_NOW and RETRY_SCHEDULED blocked — expired instrument.', actor: 'engine', offsetSeconds: 5 },
      { stage: 'decide', summary: 'Chose NUDGE_FREE with an update-card link.', actor: 'engine', offsetSeconds: 14 },
      { stage: 'act', summary: 'Sent update-card email.', actor: 'engine', offsetSeconds: 700 },
      { stage: 'verify', summary: 'Customer updated card and renewal completed.', actor: 'simulator', offsetSeconds: 700 + 5400 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 11 — a different HOLD path: uncertain_uplift (CI straddles zero).
// ===========================================================================
function scenarioUncertainHold(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Ritwik Chatterjee',
    city: 'Kolkata',
    segment: 'new',
    farming_tier: 'normal',
    farming_score: 0.05,
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 512000
  const causeCode = 'issuer_declined' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'HOLD',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
    holdReason: 'uncertain_uplift',
  })

  const eventId = idf('evt')
  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'failed_renewal',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.45, 0.62)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'HOLD', reason_code: 'uncertain_uplift', best_ev_paise: 0, margin_protected_paise: Math.round(valueAtRiskPaise * 0.05) },
    outcome: { resolution_path: 'self_recovered', net_profit_paise: Math.round(valueAtRiskPaise * (customer.gross_margin_bps / 10000)) },
    detected_at_sim: detectedAtSim,
    headline: 'Held — the model’s confidence interval on retrying straddled zero. Recovered anyway.',
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: customer.abandon_rate_90d,
      messages_received_7d: 0,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: customer.farming_score,
      farming_signals: customer.farming_signals,
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative:
        'Opaque issuer decline on a customer with only 11 days of history. The model has too little signal to be confident either way about whether a retry would help.',
      evidence: [{ signal: 'customer_tenure_days', value: '11', weight: 0.2 }],
    },
    scoring: {
      p_baseline: 0.15,
      p_baseline_ci: [0.05, 0.29],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'tenure_days', contribution: 0.18 }],
    },
    candidates,
    decision: {
      chosen_action: 'HOLD',
      reason_code: 'uncertain_uplift',
      decided_by: 'engine',
      latency_ms: randInt(rng, 20, 50),
      explanation:
        'The best candidate has a positive point-estimate EV, but its confidence interval crosses zero — we are not sure it actually helps. Value at risk is below the ambiguity-escalation threshold, so we hold rather than escalate.',
      blocked_actions: [],
    },
    actions: [],
    messages: [],
    outcome: {
      resolution_path: 'self_recovered',
      recovered_paise: valueAtRiskPaise,
      total_cost_paise: 0,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: valueAtRiskPaise,
      incremental_profit_paise: 0,
      resolved_at_sim: isoAddSeconds(detectedAtSim, 2 * 86400),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Renewal failed, issuer_declined.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'score', summary: 'p_baseline CI [0.05, 0.29] — wide, low-history customer.', actor: 'engine', offsetSeconds: 8 },
      { stage: 'decide', summary: 'Chose HOLD — best candidate CI straddles zero.', actor: 'engine', offsetSeconds: 21 },
      { stage: 'verify', summary: 'Customer self-recovered 2 days later.', actor: 'simulator', offsetSeconds: 2 * 86400 },
    ]),
  }

  return { item, detail }
}

// ===========================================================================
// Scenario 12 — a correctly-reasoned positive-EV decision that still loses.
// Honest-measurement case: the EV math was right; the outcome was still bad.
// ===========================================================================
function scenarioCorrectDecisionStillLoses(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string): CuratedCase {
  const customer = customerWith(rng, idf, {
    display_name: 'Neha Bansal',
    city: 'Jaipur',
    segment: 'casual',
    farming_tier: 'watch',
    farming_score: 0.48,
    preferred_language: 'hinglish',
  })
  const detectedAtSim = isoAddSeconds(runStartIso, randInt(rng, 3600, 25 * 86400))
  const valueAtRiskPaise = 187000
  const causeCode = 'do_not_honour' as const

  const candidates = buildCandidateTable(rng, {
    chosenAction: 'NUDGE_INCENTIVE',
    valueAtRiskPaise,
    marginBps: customer.gross_margin_bps,
    causeCode,
    blockedActions: {}, // watch-tier: incentive allowed but capped, not blocked
  })
  // Cap the incentive candidate's bps at half-strength per the "watch" tier policy (9.3 #9).
  const incentiveRow = candidates.find((c) => c.action === 'NUDGE_INCENTIVE')!

  const eventId = idf('evt')
  const actionId = idf('act')
  const sentAtSim = isoAddSeconds(detectedAtSim, 1500)
  const incentiveRupees = Math.round((valueAtRiskPaise * 500) / 10000 / 100) // capped at 5% (half of 10%)

  const item: CaseListItem = {
    id: eventId,
    customer: { id: customer.id, display_name: customer.display_name, segment: customer.segment, farming_tier: customer.farming_tier, city: customer.city },
    kind: 'abandoned_checkout',
    value_at_risk_paise: valueAtRiskPaise,
    cause_code: causeCode,
    cause_confidence: round3(randFloat(rng, 0.6, 0.8)),
    status: 'resolved',
    arm: 'agent',
    decision: { action: 'NUDGE_INCENTIVE', reason_code: 'positive_ev', best_ev_paise: incentiveRow.ev_paise, margin_protected_paise: 0 },
    outcome: { resolution_path: 'lost', net_profit_paise: -(DIRECT_COST_PAISE.NUDGE_INCENTIVE + incentiveRupees * 100) },
    detected_at_sim: detectedAtSim,
    headline: 'Positive-EV incentive sent, capped for watch-tier — customer still did not return. Marked lost.',
  }

  const message = messageFor(idf, actionId, {
    template: 'nudge_incentive',
    language: 'hinglish',
    channel: 'whatsapp',
    tone: 'warm',
    name: customer.display_name,
    amountPaise: valueAtRiskPaise,
    incentiveRupees,
    sentAtSim,
  })

  const action: CaseAction = {
    id: actionId,
    decision_id: idf('dec'),
    risk_event_id: eventId,
    type: 'NUDGE_INCENTIVE',
    params: { channel: 'whatsapp', language: 'hinglish', incentive_bps: 500, capped: true },
    scheduled_for_sim: sentAtSim,
    executed_at_sim: sentAtSim,
    status: 'executed',
    cancel_reason: null,
    cost_paise: DIRECT_COST_PAISE.NUDGE_INCENTIVE + incentiveRupees * 100,
  }

  const detail: CaseDetail = {
    event: item,
    customer_context: {
      tenure_days: customer.tenure_days,
      ltv_expected_paise: customer.ltv_expected_paise,
      gross_margin_bps: customer.gross_margin_bps,
      abandon_rate_90d: 0.44,
      messages_received_7d: 2,
      inferred_salary_day: customer.inferred_salary_day,
      farming_score: 0.48,
      farming_signals: {
        abandon_rate: 0.44,
        post_incentive_conversion: 0.58,
        incentive_dependency: 0.4,
        timing_regularity: 0.5,
        stage_consistency: 0.42,
      },
      recent_events: [],
    },
    diagnosis: {
      cause_code: causeCode,
      confidence: item.cause_confidence,
      narrative: 'Watch-tier farming score (0.48). Incentive capped at half-strength rather than withdrawn — the signal isn’t strong enough yet to remove it entirely.',
      evidence: [{ signal: 'farming_score', value: '0.48', weight: 0.22 }],
    },
    scoring: {
      p_baseline: 0.11,
      p_baseline_ci: [0.05, 0.19],
      model_version: 'p_baseline@2026-08-23T09:11Z',
      top_features: [{ name: 'farming_score', contribution: 0.2 }],
    },
    candidates,
    decision: {
      chosen_action: 'NUDGE_INCENTIVE',
      reason_code: 'positive_ev',
      decided_by: 'engine',
      latency_ms: randInt(rng, 20, 55),
      explanation: 'Capped at 5% (half the standard rate for watch-tier customers), the incentive still cleared positive EV on the model’s estimate. The customer did not convert — a reminder that a correct expected-value decision is not a guarantee.',
      blocked_actions: [],
    },
    actions: [action],
    messages: [message],
    outcome: {
      resolution_path: 'lost',
      recovered_paise: 0,
      total_cost_paise: action.cost_paise,
      net_profit_paise: item.outcome.net_profit_paise,
      counterfactual_recovered_paise: 0,
      incremental_profit_paise: item.outcome.net_profit_paise,
      resolved_at_sim: isoAddSeconds(sentAtSim, 14 * 86400),
    },
    audit_trail: auditTrail(detectedAtSim, [
      { stage: 'detect', summary: 'Issuer decline, do_not_honour.', actor: 'engine', offsetSeconds: 0 },
      { stage: 'policy', summary: 'watch-tier: incentive capped at 5% (half strength).', actor: 'engine', offsetSeconds: 6 },
      { stage: 'decide', summary: 'Chose NUDGE_INCENTIVE at capped 5%.', actor: 'engine', offsetSeconds: 20 },
      { stage: 'act', summary: 'Sent Hinglish WhatsApp message with incentive.', actor: 'engine', offsetSeconds: 1500 },
      { stage: 'verify', summary: 'No conversion within 14 sim-days. Marked lost.', actor: 'simulator', offsetSeconds: 1500 + 14 * 86400 },
    ]),
  }

  return { item, detail }
}

export function buildCuratedCases(rng: Rng, idf: ReturnType<typeof makeIdFactory>, runStartIso: string, rohitCustomerId: string): CuratedCase[] {
  return [
    scenarioCleanHold(rng, idf, runStartIso),
    scenarioPolicyBlockedFallback(rng, idf, runStartIso),
    scenarioFlaggedFarmerCutoff(rng, idf, runStartIso, rohitCustomerId),
    scenarioHighValueEscalation(rng, idf, runStartIso),
    scenarioCancelledRetry(rng, idf, runStartIso),
    scenarioHumanOverride(rng, idf, runStartIso),
    scenarioIncentiveApproved(rng, idf, runStartIso),
    scenarioRetryNowSuccess(rng, idf, runStartIso),
    scenarioScheduledRetrySuccess(rng, idf, runStartIso),
    scenarioExpiredCardNudge(rng, idf, runStartIso),
    scenarioUncertainHold(rng, idf, runStartIso),
    scenarioCorrectDecisionStillLoses(rng, idf, runStartIso),
  ]
}
