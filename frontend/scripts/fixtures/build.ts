import type {
  Action,
  Candidate,
  CaseListItem,
  CauseCode,
  Channel,
  FarmingSignals,
  FarmingTier,
  Language,
  ReasonCode,
  ResolutionPath,
  RiskEventKind,
  Segment,
  Tone,
} from '../../src/api/schemas'
import { makeIdFactory } from './ids'
import { CITY_NAMES, CITY_WEIGHTS, FIRST_NAMES, LAST_NAMES } from './pools'
import { type Rng, isoAddSeconds, longTailPaise, pick, randFloat, randInt, weightedPick } from './rng'

export const ids = (rng: Rng) => makeIdFactory(rng)

// ===========================================================================
// Section 6.3 — decline code taxonomy (shares + self-recovery rates)
// ===========================================================================

export const CAUSE_CODES: CauseCode[] = [
  'insufficient_funds',
  'issuer_declined',
  'do_not_honour',
  'expired_card',
  'mandate_revoked',
  'upi_timeout',
  'bank_downtime',
  'risk_declined',
  'card_limit_exceeded',
]
export const CAUSE_SHARES = [31, 18, 12, 9, 7, 11, 6, 4, 2]
export const SELF_RECOVERY_BY_CAUSE: Record<CauseCode, number> = {
  insufficient_funds: 0.22,
  issuer_declined: 0.15,
  do_not_honour: 0.11,
  expired_card: 0.04,
  mandate_revoked: 0.02,
  upi_timeout: 0.58,
  bank_downtime: 0.71,
  risk_declined: 0.08,
  card_limit_exceeded: 0.19,
}

export function pickCauseCode(rng: Rng): CauseCode {
  return weightedPick(rng, CAUSE_CODES, CAUSE_SHARES)
}

// ===========================================================================
// Decision mix (task spec, mirrors section 11.2's target shares)
// ===========================================================================

export const ACTIONS: Action[] = ['HOLD', 'NUDGE_FREE', 'RETRY_SCHEDULED', 'RETRY_NOW', 'NUDGE_INCENTIVE', 'ESCALATE_HUMAN']
export const ACTION_SHARES = [33, 24, 18, 12, 9, 4]

export function pickAction(rng: Rng): Action {
  return weightedPick(rng, ACTIONS, ACTION_SHARES)
}

export const DIRECT_COST_PAISE: Record<Action, number> = {
  HOLD: 0,
  RETRY_NOW: 200,
  RETRY_SCHEDULED: 200,
  NUDGE_FREE: 35,
  NUDGE_INCENTIVE: 35,
  ESCALATE_HUMAN: 8500,
}

// ===========================================================================
// Customers
// ===========================================================================

export interface GeneratedCustomer {
  id: string
  display_name: string
  segment: Segment
  farming_tier: FarmingTier
  farming_score: number
  city: string
  preferred_language: Language
  tenure_days: number
  ltv_expected_paise: number
  gross_margin_bps: number
  abandon_rate_90d: number
  inferred_salary_day: number | null
  farming_signals: FarmingSignals
}

const SEGMENTS: Segment[] = ['new', 'casual', 'regular', 'power']
const SEGMENT_SHARES = [20, 35, 30, 15]
const LANGUAGES: Language[] = ['en', 'hinglish', 'ta']
const LANGUAGE_SHARES = [55, 35, 10]
const FARMING_TIERS: FarmingTier[] = ['normal', 'watch', 'flagged']
const FARMING_TIER_SHARES = [85, 10, 5]

function usedNamePairs(rng: Rng): [string, string] {
  return [pick(rng, FIRST_NAMES), pick(rng, LAST_NAMES)]
}

export function generateCustomer(rng: Rng, idf: ReturnType<typeof makeIdFactory>): GeneratedCustomer {
  const [first, last] = usedNamePairs(rng)
  const segment = weightedPick(rng, SEGMENTS, SEGMENT_SHARES)
  const farming_tier = weightedPick(rng, FARMING_TIERS, FARMING_TIER_SHARES)
  const farming_score =
    farming_tier === 'flagged'
      ? randFloat(rng, 0.66, 0.94)
      : farming_tier === 'watch'
        ? randFloat(rng, 0.36, 0.65)
        : randFloat(rng, 0.02, 0.34)

  const segmentTenure: Record<Segment, [number, number]> = {
    new: [3, 89],
    casual: [90, 399],
    regular: [400, 899],
    power: [900, 2500],
  }
  const segmentLtv: Record<Segment, [number, number]> = {
    new: [400, 4800],
    casual: [1800, 14500],
    regular: [7500, 58000],
    power: [28000, 310000],
  }
  const segmentMargin: Record<Segment, [number, number]> = {
    new: [1800, 2200],
    casual: [2000, 2400],
    regular: [2200, 2700],
    power: [2400, 3100],
  }

  const [tenureLo, tenureHi] = segmentTenure[segment]
  const [ltvLo, ltvHi] = segmentLtv[segment]
  const [marginLo, marginHi] = segmentMargin[segment]

  const abandon_rate_90d = farming_tier === 'normal' ? randFloat(rng, 0.04, 0.38) : randFloat(rng, 0.35, 0.72)

  const s1 = clamp01(farming_score + randFloat(rng, -0.08, 0.08))
  const s2 = clamp01(farming_score + randFloat(rng, -0.1, 0.1))
  const s3 = clamp01(farming_score + randFloat(rng, -0.1, 0.1))
  const s4 = clamp01(farming_score + randFloat(rng, -0.12, 0.12))
  const s5 = clamp01(farming_score + randFloat(rng, -0.12, 0.12))

  return {
    id: idf('cus'),
    display_name: `${first} ${last}`,
    segment,
    farming_tier,
    farming_score: round3(farming_score),
    city: weightedPick(rng, CITY_NAMES, CITY_WEIGHTS),
    preferred_language: weightedPick(rng, LANGUAGES, LANGUAGE_SHARES),
    tenure_days: randInt(rng, tenureLo, tenureHi),
    ltv_expected_paise: Math.round(randFloat(rng, ltvLo, ltvHi) * 100) + randInt(rng, -41, 37),
    gross_margin_bps: randInt(rng, marginLo, marginHi),
    abandon_rate_90d: round3(abandon_rate_90d),
    inferred_salary_day: rng() < 0.3 ? null : randInt(rng, 1, 28),
    farming_signals: {
      abandon_rate: round3(s1),
      post_incentive_conversion: round3(s2),
      incentive_dependency: round3(s3),
      timing_regularity: round3(s4),
      stage_consistency: round3(s5),
    },
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
export function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

// ===========================================================================
// Value at risk — long tail, mostly ₹300–₹2,500, a thin tail above ₹20,000
// ===========================================================================

export function sampleValueAtRiskPaise(rng: Rng): number {
  return longTailPaise(rng, 300, 2500, 5200, 148000)
}

// ===========================================================================
// Bulk CaseListItem generation
// ===========================================================================

export interface BulkCaseResult {
  item: CaseListItem
  customer: GeneratedCustomer
}

const REASONS_FOR_HOLD: ReasonCode[] = ['no_action_beats_hold', 'uncertain_uplift', 'edge_too_thin']
const REASONS_FOR_HOLD_SHARES = [60, 25, 15]
const KINDS: RiskEventKind[] = ['abandoned_checkout', 'failed_renewal']
const KIND_SHARES = [55, 45]
const ARMS = ['agent', 'baseline', 'holdout'] as const
const ARM_SHARES = [70, 20, 10]

export function generateBulkCase(rng: Rng, idf: ReturnType<typeof makeIdFactory>, detectedAtSim: string): BulkCaseResult {
  const customer = generateCustomer(rng, idf)
  const kind = weightedPick(rng, KINDS, KIND_SHARES)
  const cause_code = pickCauseCode(rng)
  const value_at_risk_paise = sampleValueAtRiskPaise(rng)
  const action = pickAction(rng)
  const arm = weightedPick(rng, ARMS, ARM_SHARES)

  const reason_code: ReasonCode =
    action === 'HOLD'
      ? weightedPick(rng, REASONS_FOR_HOLD, REASONS_FOR_HOLD_SHARES)
      : action === 'ESCALATE_HUMAN'
        ? weightedPick<ReasonCode>(rng, ['high_value_ambiguous', 'positive_ev'], [70, 30])
        : weightedPick<ReasonCode>(rng, ['positive_ev', 'policy_blocked'], [90, 10])

  let best_ev_paise: number
  let margin_protected_paise: number
  if (action === 'HOLD') {
    margin_protected_paise = Math.round(value_at_risk_paise * randFloat(rng, 0.015, 0.11)) + randInt(rng, 11, 89)
    best_ev_paise = reason_code === 'edge_too_thin' ? randInt(rng, 0, 480) : -randInt(rng, 40, 42000)
  } else {
    margin_protected_paise = 0
    best_ev_paise = Math.round(value_at_risk_paise * randFloat(rng, 0.02, 0.22)) + randInt(rng, 7, 900)
  }

  const selfRecoveryRate = SELF_RECOVERY_BY_CAUSE[cause_code]
  const resolution_path = pickResolutionPath(rng, action, selfRecoveryRate)
  const marginRate = customer.gross_margin_bps / 10000
  const net_profit_paise = computeNetProfit(rng, action, resolution_path, value_at_risk_paise, marginRate)

  const status = rng() < 0.91 ? 'resolved' : 'expired'
  const headline = buildHeadline(rng, action, resolution_path, value_at_risk_paise)

  const item: CaseListItem = {
    id: idf('evt'),
    customer: {
      id: customer.id,
      display_name: customer.display_name,
      segment: customer.segment,
      farming_tier: customer.farming_tier,
      city: customer.city,
    },
    kind,
    value_at_risk_paise,
    cause_code,
    cause_confidence: round3(randFloat(rng, 0.58, 0.97)),
    status: status === 'expired' ? 'expired' : 'resolved',
    arm,
    decision: { action, reason_code, best_ev_paise, margin_protected_paise },
    outcome: { resolution_path, net_profit_paise },
    detected_at_sim: detectedAtSim,
    headline,
  }

  return { item, customer }
}

function pickResolutionPath(rng: Rng, action: Action, selfRecoveryRate: number): ResolutionPath {
  if (action === 'HOLD') {
    return weightedPick<ResolutionPath>(
      rng,
      ['self_recovered', 'lost', 'expired'],
      [Math.round(selfRecoveryRate * 100), 100 - Math.round(selfRecoveryRate * 100) - 8, 8],
    )
  }
  return weightedPick<ResolutionPath>(rng, ['agent_recovered', 'self_recovered', 'lost'], [62, 18, 20])
}

function computeNetProfit(rng: Rng, action: Action, path: ResolutionPath, value: number, marginRate: number): number {
  if (path === 'self_recovered') {
    return Math.round(value * marginRate) + randInt(rng, -19, 23)
  }
  if (path === 'agent_recovered') {
    const cost = DIRECT_COST_PAISE[action] + (action === 'NUDGE_INCENTIVE' ? Math.round(value * randFloat(rng, 0.05, 0.12)) : 0)
    return Math.round(value * marginRate) - cost + randInt(rng, -17, 19)
  }
  if (path === 'lost') {
    const cost = action === 'HOLD' ? 0 : DIRECT_COST_PAISE[action] + randInt(rng, 0, 120)
    return -cost
  }
  return randInt(rng, -35, 0) // expired
}

function buildHeadline(rng: Rng, action: Action, path: ResolutionPath, value: number): string {
  const amount = `₹${Math.round(value / 100).toLocaleString('en-IN')}`
  if (action === 'HOLD' && path === 'self_recovered') {
    const h = randInt(rng, 1, 11)
    const m = randInt(rng, 0, 59)
    return pick(rng, [
      `Returned on their own in ${h}h ${m}m. We spent nothing.`,
      `Came back unprompted after ${h}h ${m}m. No message sent.`,
    ])
  }
  if (path === 'agent_recovered' && action === 'NUDGE_INCENTIVE') return `Recovered ${amount} after an incentive.`
  if (path === 'agent_recovered' && (action === 'RETRY_NOW' || action === 'RETRY_SCHEDULED')) return `Recovered ${amount} on retry.`
  if (path === 'agent_recovered' && action === 'NUDGE_FREE') return `Recovered ${amount} after a free reminder.`
  if (path === 'agent_recovered' && action === 'ESCALATE_HUMAN') return 'Recovered after human follow-up.'
  if (path === 'lost') return pick(rng, ['No response after contact. Marked lost.', 'Customer did not return. Marked lost.'])
  if (path === 'expired') return 'Event aged out with no resolution.'
  return `Resolved: ${amount} at risk.`
}

// ===========================================================================
// Misc small helpers shared by other fixture builders
// ===========================================================================

export function randomSimTimestamp(rng: Rng, startedAtIso: string, windowDays: number): string {
  const seconds = randInt(rng, 0, windowDays * 86400)
  return isoAddSeconds(startedAtIso, seconds)
}

export function randomChannelFor(language: Language, rng: Rng): Channel {
  return rng() < 0.82 ? 'whatsapp' : language === 'en' ? 'email' : 'whatsapp'
}

export function randomTone(rng: Rng): Tone {
  return weightedPick<Tone>(rng, ['warm', 'neutral', 'urgent'], [55, 35, 10])
}

// ===========================================================================
// Full six-row EV candidate table for CaseDetail records (section 4.2/4.3).
// Built programmatically rather than hand-transcribed so the arithmetic is
// guaranteed self-consistent: the chosen action really is the best-EV
// *allowed* candidate (or, for HOLD, every allowed candidate really is <= 0
// / below τ / CI-straddles-zero, matching whichever restraint path is asked for).
// ===========================================================================

export interface CandidateTableOptions {
  chosenAction: Action
  valueAtRiskPaise: number
  marginBps: number
  causeCode: CauseCode
  /** Only meaningful when chosenAction === 'HOLD' — which of the 3 restraint paths (4.3) this is. */
  holdReason?: ReasonCode
  /** action -> block reason. Blocked actions are excluded from the "must be beaten" comparison. */
  blockedActions?: Partial<Record<Action, string>>
}

const TAU_PAISE = 500 // section 4.3 minimum edge

export function buildCandidateTable(rng: Rng, opts: CandidateTableOptions): Candidate[] {
  const marginRate = opts.marginBps / 10000
  const pBaseline = SELF_RECOVERY_BY_CAUSE[opts.causeCode]

  interface Row {
    action: Action
    p_recover: number
    uplift: number
    gross_gain_paise: number
    direct_cost_paise: number
    incentive_cost_paise: number
    annoyance_cost_paise: number
    farming_cost_paise: number
    ev_paise: number
    allowed: boolean
    block_reason: string | null
  }

  const rows: Row[] = ACTIONS.map((action) => {
    const blockReason = opts.blockedActions?.[action] ?? null
    const direct_cost_paise = DIRECT_COST_PAISE[action]
    let upliftBase = 0
    switch (action) {
      case 'HOLD':
        upliftBase = 0
        break
      case 'RETRY_NOW':
        upliftBase = randFloat(rng, -0.01, 0.06)
        break
      case 'RETRY_SCHEDULED':
        upliftBase = randFloat(rng, 0.03, 0.18)
        break
      case 'NUDGE_FREE':
        upliftBase = randFloat(rng, -0.005, 0.07)
        break
      case 'NUDGE_INCENTIVE':
        upliftBase = randFloat(rng, 0.07, 0.24)
        break
      case 'ESCALATE_HUMAN':
        upliftBase = randFloat(rng, 0.01, 0.11)
        break
    }
    const p_recover = clamp01(pBaseline + upliftBase)
    const uplift = round3(p_recover - pBaseline)
    const gross_gain_paise = Math.round(uplift * opts.valueAtRiskPaise * marginRate)
    const incentiveBps = action === 'NUDGE_INCENTIVE' ? randInt(rng, 500, 1200) : 0
    const incentive_cost_paise = action === 'NUDGE_INCENTIVE' ? Math.round((opts.valueAtRiskPaise * incentiveBps) / 10000) : 0
    const annoyance_cost_paise = action === 'HOLD' ? 0 : Math.round(direct_cost_paise * randFloat(rng, 1.5, 6)) + randInt(rng, 0, 200)
    const farming_cost_paise = 0
    const ev_paise =
      action === 'HOLD' ? 0 : gross_gain_paise - direct_cost_paise - incentive_cost_paise - annoyance_cost_paise - farming_cost_paise

    return {
      action,
      p_recover: round3(p_recover),
      uplift,
      gross_gain_paise,
      direct_cost_paise,
      incentive_cost_paise,
      annoyance_cost_paise,
      farming_cost_paise,
      ev_paise,
      allowed: blockReason === null,
      block_reason: blockReason,
    }
  })

  const byAction = new Map(rows.map((r) => [r.action, r]))
  const chosen = byAction.get(opts.chosenAction)!
  const allowedOthers = rows.filter((r) => r.action !== opts.chosenAction && r.allowed)

  if (opts.chosenAction === 'HOLD') {
    const reason = opts.holdReason ?? 'no_action_beats_hold'
    const topOtherIdx = allowedOthers.reduce((bi, r, i, arr) => (r.ev_paise > arr[bi].ev_paise ? i : bi), 0)
    for (let i = 0; i < allowedOthers.length; i++) {
      const r = allowedOthers[i]
      if (reason === 'no_action_beats_hold') {
        if (r.ev_paise >= 0) r.ev_paise = -randInt(rng, 15, 4200)
      } else if (reason === 'edge_too_thin') {
        if (i === topOtherIdx) r.ev_paise = randInt(rng, 10, TAU_PAISE - 1)
        else if (r.ev_paise >= 0) r.ev_paise = -randInt(rng, 15, 4200)
      } else if (reason === 'uncertain_uplift') {
        if (i === topOtherIdx) r.ev_paise = randInt(rng, 300, 8000)
        else if (r.ev_paise >= 0) r.ev_paise = -randInt(rng, 15, 4200)
      }
    }
  } else {
    const maxOtherEv = Math.max(0, ...allowedOthers.map((r) => r.ev_paise))
    if (chosen.ev_paise <= maxOtherEv + TAU_PAISE) {
      chosen.ev_paise = maxOtherEv + TAU_PAISE + randInt(rng, 80, 6000)
    }
    for (const r of allowedOthers) {
      if (r.ev_paise >= chosen.ev_paise) r.ev_paise = chosen.ev_paise - randInt(rng, TAU_PAISE, 5000)
    }
  }

  const sorted = [...rows].sort((a, b) => b.ev_paise - a.ev_paise)
  const rankOf = new Map(sorted.map((r, i) => [r.action, i + 1]))

  return rows.map((r): Candidate => {
    const spread = Math.max(200, Math.round(Math.abs(r.ev_paise) * 0.35) + 150)
    let ci_low_paise = r.ev_paise - spread
    let ci_high_paise = r.ev_paise + spread

    if (r.action === opts.chosenAction && opts.chosenAction !== 'HOLD') {
      ci_low_paise = Math.max(1, r.ev_paise - Math.round(spread * 0.5))
    }
    if (opts.chosenAction === 'HOLD' && opts.holdReason === 'uncertain_uplift' && r.ev_paise > 0 && r.ev_paise < 8000) {
      ci_low_paise = -Math.round(spread * 0.6)
    }

    return {
      action: r.action,
      p_recover: r.p_recover,
      uplift: r.uplift,
      gross_gain_paise: r.gross_gain_paise,
      direct_cost_paise: r.direct_cost_paise,
      incentive_cost_paise: r.incentive_cost_paise,
      annoyance_cost_paise: r.annoyance_cost_paise,
      farming_cost_paise: r.farming_cost_paise,
      ev_paise: r.ev_paise,
      ci_low_paise,
      ci_high_paise,
      allowed: r.allowed,
      block_reason: r.block_reason,
      rank: rankOf.get(r.action)!,
    }
  })
}
