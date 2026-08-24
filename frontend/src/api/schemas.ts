import { z } from 'zod'

// ---------------------------------------------------------------------------
// This file is the authoritative contract between the frontend and the
// FastAPI backend (spec section 8.4/8.5). Every schema below is either:
//   1. Copied directly from a JSON example in section 8.4/8.5, or
//   2. Derived from the canonical DB column definitions in section 5.4 /
//      the decline taxonomy in 6.3 / the policy example in 9.2, when 8.4
//      references a type without inlining its shape.
//
// Fields/schemas derived via (2) — or where the spec is genuinely silent —
// are marked "ASSUMED" and are listed with full reasoning in the chat
// response that accompanied this file. Do not treat an ASSUMED schema as
// confirmed; it exists so the file compiles and the exports the task asked
// for are present, not because the shape is verified against 8.4.
// ---------------------------------------------------------------------------

// ===========================================================================
// Enums
// ===========================================================================

export const ArmSchema = z.enum(['agent', 'baseline', 'holdout'])
export type Arm = z.infer<typeof ArmSchema>

export const RunStatusSchema = z.enum(['pending', 'running', 'paused', 'completed', 'failed']) // 5.4 runs.status
export type RunStatus = z.infer<typeof RunStatusSchema>

export const RiskEventKindSchema = z.enum(['failed_renewal', 'abandoned_checkout']) // 5.4 risk_events.kind
export type RiskEventKind = z.infer<typeof RiskEventKindSchema>

export const RiskEventStatusSchema = z.enum([
  'detected',
  'diagnosed',
  'scored',
  'decided',
  'acting',
  'resolved',
  'expired',
]) // 5.4 risk_events.status
export type RiskEventStatus = z.infer<typeof RiskEventStatusSchema>

// ASSUMED: 6.3 titles this the "decline code taxonomy" and every example value
// is a payment-decline code, but the CaseListItem example (8.4) applies
// "upi_timeout" to an `abandoned_checkout` event. Assuming the same 9-value
// taxonomy is shared across both verticals (checkout abandonment can also
// stall on a payment_attempt). See question list.
export const CauseCodeSchema = z.enum([
  'insufficient_funds',
  'issuer_declined',
  'do_not_honour',
  'expired_card',
  'mandate_revoked',
  'upi_timeout',
  'bank_downtime',
  'risk_declined',
  'card_limit_exceeded',
])
export type CauseCode = z.infer<typeof CauseCodeSchema>

export const ActionSchema = z.enum([
  'HOLD',
  'RETRY_NOW',
  'RETRY_SCHEDULED',
  'NUDGE_FREE',
  'NUDGE_INCENTIVE',
  'ESCALATE_HUMAN',
]) // 4.1 action space
export type Action = z.infer<typeof ActionSchema>

export const ReasonCodeSchema = z.enum([
  'positive_ev',
  'no_action_beats_hold',
  'uncertain_uplift',
  'edge_too_thin',
  'policy_blocked',
  'high_value_ambiguous',
]) // 5.4 decisions.reason_code
export type ReasonCode = z.infer<typeof ReasonCodeSchema>

export const DecidedBySchema = z.enum(['engine', 'llm_adjudicator', 'human_override']) // 5.4 decisions.decided_by
export type DecidedBy = z.infer<typeof DecidedBySchema>

export const ResolutionPathSchema = z.enum(['self_recovered', 'agent_recovered', 'lost', 'expired']) // 5.4 outcomes.resolution_path
export type ResolutionPath = z.infer<typeof ResolutionPathSchema>

export const ActionStatusSchema = z.enum(['scheduled', 'executed', 'cancelled', 'blocked']) // 5.4 actions.status
export type ActionStatus = z.infer<typeof ActionStatusSchema>

export const ChannelSchema = z.enum(['whatsapp', 'email', 'sms']) // 5.4 messages.channel
export type Channel = z.infer<typeof ChannelSchema>

export const LanguageSchema = z.enum(['en', 'hinglish', 'ta']) // 5.4 customers.preferred_language
export type Language = z.infer<typeof LanguageSchema>

export const ToneSchema = z.enum(['warm', 'neutral', 'urgent']) // 5.4 messages.tone
export type Tone = z.infer<typeof ToneSchema>

export const SegmentSchema = z.enum(['new', 'casual', 'regular', 'power']) // 5.4 customers.segment
export type Segment = z.infer<typeof SegmentSchema>

export const FarmingTierSchema = z.enum(['normal', 'watch', 'flagged']) // 5.4 customers.farming_tier
export type FarmingTier = z.infer<typeof FarmingTierSchema>

export const AuditStageSchema = z.enum([
  'detect',
  'diagnose',
  'score',
  'decide',
  'act',
  'verify',
  'policy',
  'override',
]) // 5.4 audit_entries.stage
export type AuditStage = z.infer<typeof AuditStageSchema>

export const AuditActorSchema = z.enum(['engine', 'llm', 'human', 'simulator']) // 5.4 audit_entries.actor
export type AuditActor = z.infer<typeof AuditActorSchema>

export const PolicyKindSchema = z.enum(['hard_block', 'cap', 'require_approval']) // 5.4 policies.kind
export type PolicyKind = z.infer<typeof PolicyKindSchema>

export const PolicyAuthoredBySchema = z.enum(['system', 'operator', 'llm_proposal']) // 5.4 policies.authored_by
export type PolicyAuthoredBy = z.infer<typeof PolicyAuthoredBySchema>

// ASSUMED: 5.4 world_configs.name lists exactly these 3 pipe-separated values,
// same convention as every other enum column in that section — but 10.11
// implies these are UI preset labels, and an operator saving a live
// judge-tweaked config might need a free-form name. See question list.
export const WorldConfigNameSchema = z.enum(['default', 'pessimistic', 'judge_custom'])
export type WorldConfigName = z.infer<typeof WorldConfigNameSchema>

// ===========================================================================
// Shared primitives
// ===========================================================================

const Paise = z.number().int()
const Probability = z.number().min(0).max(1)
const IsoDateTime = z.string().datetime()

// ===========================================================================
// World params (section 6.5 — the adversarial knobs)
// Fully enumerated with defaults and ranges in the spec, so bounds below are
// taken directly from the "Range" column, not guessed.
// ===========================================================================

export const WorldParamsSchema = z.object({
  salary_timing_lift: z.number().min(1.0).max(4.0),
  self_recovery_base: z.number().min(0.05).max(0.7),
  incentive_elasticity: z.number().min(1.0).max(3.0),
  farmer_share: z.number().min(0.0).max(0.4),
  farmer_learning_rate: z.number().min(0.0).max(0.5),
  message_fatigue: z.number().min(0.0).max(1.0),
  margin_rate_bps: z.number().int().min(500).max(6000),
  optout_sensitivity: z.number().min(0.0).max(3.0),
  population_size: z.number().int().min(200).max(20000),
  sim_days: z.number().int().min(7).max(90),
  seed: z.number().int(),
})
export type WorldParams = z.infer<typeof WorldParamsSchema>

export const WorldConfigSchema = z.object({
  id: z.string(),
  name: WorldConfigNameSchema,
  params: WorldParamsSchema,
  created_at: IsoDateTime,
})
export type WorldConfig = z.infer<typeof WorldConfigSchema>

// ===========================================================================
// Runs
// ===========================================================================

export const RunProgressSchema = z.object({
  sim_day: z.number().int(),
  total_days: z.number().int(),
  events_processed: z.number().int(),
  events_total: z.number().int(),
})

export const RunSummarySchema = z.object({
  id: z.string(),
  status: RunStatusSchema,
  arms: z.array(ArmSchema),
  population_size: z.number().int(),
  sim_days: z.number().int(),
  seed: z.number().int(),
  progress: RunProgressSchema,
  started_at: IsoDateTime,
  completed_at: IsoDateTime.nullable(),
})
export type RunSummary = z.infer<typeof RunSummarySchema>

// ASSUMED — 8.4 lists "GET /api/runs/{run_id} → RunDetail" and pause/resume
// return RunDetail too, but no RunDetail JSON example exists anywhere in the
// document. Assuming RunDetail = RunSummary + the resolved WorldConfig used
// for the run. See question list — this is the least-confident schema here.
export const RunDetailSchema = RunSummarySchema.extend({
  world_config: WorldConfigSchema,
})
export type RunDetail = z.infer<typeof RunDetailSchema>

export const RunCreateRequestSchema = z.object({
  world_config_id: z.string(),
  arms: z.array(ArmSchema),
  population_size: z.number().int(),
  sim_days: z.number().int(),
  seed: z.number().int(),
})
export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>

export const RunSpeedRequestSchema = z.object({
  speed: z.number(),
})
export type RunSpeedRequest = z.infer<typeof RunSpeedRequestSchema>

// ===========================================================================
// Run metrics (the Ledger screen)
// ===========================================================================

export const ArmMetricsSchema = z.object({
  events: z.number().int(),
  value_at_risk_paise: Paise,
  recovered_paise: Paise,
  spend_paise: Paise,
  net_profit_paise: Paise,
  incremental_profit_paise: Paise,
  recovery_rate: z.number(),
  actions_taken: z.number().int(),
  holds: z.number().int(),
  margin_protected_paise: Paise,
  optouts: z.number().int(),
  messages_sent: z.number().int(),
})
export type ArmMetrics = z.infer<typeof ArmMetricsSchema>

export const RunMetricsDeltasSchema = z.object({
  net_profit_vs_baseline_paise: Paise,
  net_profit_vs_baseline_pct: z.number(),
  spend_reduction_pct: z.number(),
  recovery_rate_delta: z.number(),
})

export const RunMetricsSeriesPointSchema = z.object({
  sim_day: z.number().int(),
  agent_net_paise: Paise,
  baseline_net_paise: Paise,
  holdout_net_paise: Paise,
})

export const QiniPointSchema = z.object({
  fraction: z.number(),
  agent: z.number(),
  random: z.number(),
})

export const CalibrationPointSchema = z.object({
  predicted: z.number(),
  observed: z.number(),
  n: z.number().int(),
})

// ASSUMED: all three arm keys are modeled as required, matching the literal
// example. If a run only includes 2 arms (holdout is the first thing cut per
// 12.1), this object presumably can't supply a `holdout` key. See question list.
export const RunMetricsSchema = z.object({
  run_id: z.string(),
  arms: z.object({
    agent: ArmMetricsSchema,
    baseline: ArmMetricsSchema,
    holdout: ArmMetricsSchema,
  }),
  deltas: RunMetricsDeltasSchema,
  series: z.array(RunMetricsSeriesPointSchema),
  qini: z.object({
    coefficient: z.number(),
    points: z.array(QiniPointSchema),
  }),
  calibration: z.array(CalibrationPointSchema),
})
export type RunMetrics = z.infer<typeof RunMetricsSchema>

// ===========================================================================
// Cases
// ===========================================================================

export const CaseCustomerSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  segment: SegmentSchema,
  farming_tier: FarmingTierSchema,
  city: z.string(),
})
export type CaseCustomer = z.infer<typeof CaseCustomerSchema>

export const CaseDecisionSummarySchema = z.object({
  action: ActionSchema,
  reason_code: ReasonCodeSchema,
  best_ev_paise: Paise,
  margin_protected_paise: Paise,
})
export type CaseDecisionSummary = z.infer<typeof CaseDecisionSummarySchema>

export const CaseOutcomeSummarySchema = z.object({
  resolution_path: ResolutionPathSchema,
  net_profit_paise: Paise,
})
export type CaseOutcomeSummary = z.infer<typeof CaseOutcomeSummarySchema>

export const CaseListItemSchema = z.object({
  id: z.string(),
  customer: CaseCustomerSchema,
  kind: RiskEventKindSchema,
  value_at_risk_paise: Paise,
  cause_code: CauseCodeSchema,
  cause_confidence: Probability,
  status: RiskEventStatusSchema,
  arm: ArmSchema,
  decision: CaseDecisionSummarySchema,
  outcome: CaseOutcomeSummarySchema,
  detected_at_sim: IsoDateTime,
  headline: z.string(),
})
export type CaseListItem = z.infer<typeof CaseListItemSchema>

export const CasesListResponseSchema = z.object({
  items: z.array(CaseListItemSchema),
  next_cursor: z.string().nullable(),
})
export type CasesListResponse = z.infer<typeof CasesListResponseSchema>

// --- CaseDetail sub-shapes -------------------------------------------------

export const FarmingSignalsSchema = z.object({
  abandon_rate: Probability,
  post_incentive_conversion: Probability,
  incentive_dependency: Probability,
  timing_regularity: Probability,
  stage_consistency: Probability,
})
export type FarmingSignals = z.infer<typeof FarmingSignalsSchema>

export const RecentEventSchema = z.object({
  id: z.string(),
  kind: RiskEventKindSchema,
  outcome: ResolutionPathSchema,
  at: IsoDateTime,
})
export type RecentEvent = z.infer<typeof RecentEventSchema>

export const CustomerContextSchema = z.object({
  tenure_days: z.number().int(),
  ltv_expected_paise: Paise,
  gross_margin_bps: z.number().int(),
  abandon_rate_90d: Probability,
  messages_received_7d: z.number().int(),
  inferred_salary_day: z.number().int().nullable(),
  farming_score: Probability,
  farming_signals: FarmingSignalsSchema,
  recent_events: z.array(RecentEventSchema),
})

export const EvidenceSchema = z.object({
  signal: z.string(),
  value: z.string(),
  weight: z.number(),
})
export type Evidence = z.infer<typeof EvidenceSchema>

export const DiagnosisSchema = z.object({
  cause_code: CauseCodeSchema,
  confidence: Probability,
  narrative: z.string().nullable(),
  evidence: z.array(EvidenceSchema),
})
export type Diagnosis = z.infer<typeof DiagnosisSchema>

export const TopFeatureSchema = z.object({
  name: z.string(),
  contribution: z.number(),
})
export type TopFeature = z.infer<typeof TopFeatureSchema>

export const ScoringSchema = z.object({
  p_baseline: Probability,
  p_baseline_ci: z.tuple([z.number(), z.number()]),
  model_version: z.string(),
  top_features: z.array(TopFeatureSchema),
})
export type Scoring = z.infer<typeof ScoringSchema>

export const CandidateSchema = z.object({
  action: ActionSchema,
  p_recover: Probability,
  uplift: z.number(),
  gross_gain_paise: Paise,
  direct_cost_paise: Paise,
  incentive_cost_paise: Paise,
  annoyance_cost_paise: Paise,
  farming_cost_paise: Paise,
  ev_paise: Paise,
  ci_low_paise: Paise,
  ci_high_paise: Paise,
  allowed: z.boolean(),
  block_reason: z.string().nullable(),
  rank: z.number().int(),
})
export type Candidate = z.infer<typeof CandidateSchema>

export const BlockedActionSchema = z.object({
  action: ActionSchema,
  policy_id: z.string(),
  policy_name: z.string(),
})
export type BlockedAction = z.infer<typeof BlockedActionSchema>

export const DecisionSchema = z.object({
  chosen_action: ActionSchema,
  reason_code: ReasonCodeSchema,
  decided_by: DecidedBySchema,
  latency_ms: z.number().int(),
  explanation: z.string(),
  blocked_actions: z.array(BlockedActionSchema),
})
export type Decision = z.infer<typeof DecisionSchema>

// 5.4 `actions` table — not populated in the 8.4 example (shown as `[]`), so
// this is derived from the DB columns rather than an inline JSON example.
export const CaseActionSchema = z.object({
  id: z.string(),
  decision_id: z.string(),
  risk_event_id: z.string(),
  type: ActionSchema,
  params: z.record(z.string(), z.unknown()), // ASSUMED loose — see question list
  scheduled_for_sim: IsoDateTime,
  executed_at_sim: IsoDateTime.nullable(),
  status: ActionStatusSchema,
  cancel_reason: z.string().nullable(),
  cost_paise: Paise,
})
export type CaseAction = z.infer<typeof CaseActionSchema>

// 5.4 `messages` table — same caveat as CaseActionSchema above.
export const CaseMessageSchema = z.object({
  id: z.string(),
  action_id: z.string(),
  channel: ChannelSchema,
  language: LanguageSchema,
  body: z.string(),
  incentive_bps: z.number().int(),
  tone: ToneSchema,
  policy_checks_passed: z.array(z.object({ rule: z.string(), passed: z.boolean() })),
  sent_at_sim: IsoDateTime.nullable(),
  opened: z.boolean(),
  clicked: z.boolean(),
})
export type CaseMessage = z.infer<typeof CaseMessageSchema>

// ASSUMED: the 8.4 example omits `customer_opted_out` (present in the 5.4
// `outcomes` table) without an ellipsis marker, which could mean either "not
// part of the API surface" or "omitted for brevity". Left out here to match
// the literal example. See question list.
export const OutcomeSchema = z.object({
  resolution_path: ResolutionPathSchema,
  recovered_paise: Paise,
  total_cost_paise: Paise,
  net_profit_paise: Paise,
  counterfactual_recovered_paise: Paise,
  incremental_profit_paise: Paise,
  resolved_at_sim: IsoDateTime,
})
export type Outcome = z.infer<typeof OutcomeSchema>

export const CaseAuditTrailEntrySchema = z.object({
  stage: AuditStageSchema,
  summary: z.string(),
  sim_time: IsoDateTime,
  actor: AuditActorSchema,
})
export type CaseAuditTrailEntry = z.infer<typeof CaseAuditTrailEntrySchema>

export const CaseDetailSchema = z.object({
  event: CaseListItemSchema,
  customer_context: CustomerContextSchema,
  diagnosis: DiagnosisSchema,
  scoring: ScoringSchema,
  candidates: z.array(CandidateSchema),
  decision: DecisionSchema,
  actions: z.array(CaseActionSchema),
  messages: z.array(CaseMessageSchema),
  outcome: OutcomeSchema,
  audit_trail: z.array(CaseAuditTrailEntrySchema),
})
export type CaseDetail = z.infer<typeof CaseDetailSchema>

export const CaseOverrideRequestSchema = z.object({
  action: ActionSchema,
  params: z.record(z.string(), z.unknown()), // ASSUMED loose — see question list
  reason: z.string(),
})
export type CaseOverrideRequest = z.infer<typeof CaseOverrideRequestSchema>

export const CaseNarrativeResponseSchema = z.object({
  narrative: z.string(),
})
export type CaseNarrativeResponse = z.infer<typeof CaseNarrativeResponseSchema>

// ===========================================================================
// Watchlist — ASSUMED throughout. Section 8.4 gives no JSON example for
// either WatchlistEntry or WatchlistDetail; this is reconstructed from the
// 10.9 UI mockup table (CUSTOMER / TIER / SCORE / ABANDONS / INCENTIVES /
// EXTRACTED) and the FarmingDetail prose. See question list.
// ===========================================================================

export const WatchlistEntrySchema = z.object({
  customer_id: z.string(),
  display_name: z.string(),
  farming_tier: FarmingTierSchema,
  farming_score: Probability,
  abandons: z.number().int(),
  checkouts_observed: z.number().int(),
  incentives_sent: z.number().int(),
  incentives_extracted_paise: Paise,
})
export type WatchlistEntry = z.infer<typeof WatchlistEntrySchema>

export const WatchlistScorePointSchema = z.object({
  at: IsoDateTime,
  score: Probability,
})

export const WatchlistDetailSchema = WatchlistEntrySchema.extend({
  score_timeline: z.array(WatchlistScorePointSchema),
  farming_signals: FarmingSignalsSchema,
  events: z.array(RecentEventSchema),
})
export type WatchlistDetail = z.infer<typeof WatchlistDetailSchema>

// ===========================================================================
// Policies
// ===========================================================================

// `rule` is a recursive structured predicate (9.2 shows one example: an
// `any` combinator over `{field, op, value}` conditions with ops "gte"/"lt").
// The full combinator/op vocabulary is never enumerated, so this is left
// untyped rather than fabricating an op enum. See question list.
export const PolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: PolicyKindSchema,
  rule: z.unknown(),
  applies_to: z.array(ActionSchema),
  enabled: z.boolean(),
  authored_by: PolicyAuthoredBySchema,
  trigger_count: z.number().int(),
})
export type Policy = z.infer<typeof PolicySchema>

export const PolicyUpdateRequestSchema = z.object({
  enabled: z.boolean().optional(),
  rule: z.unknown().optional(),
})
export type PolicyUpdateRequest = z.infer<typeof PolicyUpdateRequestSchema>

// ASSUMED — no JSON example exists; reconstructed from 4.4 item 5 ("structured
// rule proposal") and 10.10 ("rendered as a diff-style block"). Modeled as the
// authorable subset of Policy plus a reasoning string. See question list.
export const PolicyProposalSchema = z.object({
  name: z.string(),
  kind: PolicyKindSchema,
  applies_to: z.array(ActionSchema),
  rule: z.unknown(),
  reasoning: z.string(),
})
export type PolicyProposal = z.infer<typeof PolicyProposalSchema>

export const PolicyProposeRequestSchema = z.object({
  text: z.string(),
})
export type PolicyProposeRequest = z.infer<typeof PolicyProposeRequestSchema>

// ASSUMED: `policies` in the request body is typed as a list of policy IDs to
// simulate as enabled — the spec names the field but not its element type.
// See question list.
export const PolicySimulateRequestSchema = z.object({
  run_id: z.string(),
  policies: z.array(z.string()),
})
export type PolicySimulateRequest = z.infer<typeof PolicySimulateRequestSchema>

export const PolicySimulateResponseSchema = z.object({
  blocked_count: z.number().int(),
  net_profit_delta_paise: Paise,
})
export type PolicySimulateResponse = z.infer<typeof PolicySimulateResponseSchema>

// ===========================================================================
// World
// ===========================================================================

export const WorldConfigCreateRequestSchema = z.object({
  name: WorldConfigNameSchema,
  params: WorldParamsSchema,
})
export type WorldConfigCreateRequest = z.infer<typeof WorldConfigCreateRequestSchema>

// NOTE: `agent_net` / `baseline_net` below are copied verbatim from the 8.4
// example. Confirmed with spec author: this is a naming inconsistency in the
// spec (they are paise values). TODO backend — rename to
// `agent_net_paise` / `baseline_net_paise` to match the rest of the contract;
// update this schema (and drop this note) once that lands.
export const WorldSweepResultSchema = z.object({
  params: WorldParamsSchema,
  agent_net: z.number().int(),
  baseline_net: z.number().int(),
  agent_wins: z.boolean(),
})
export type WorldSweepResult = z.infer<typeof WorldSweepResultSchema>

export const WorldSweepResponseSchema = z.object({
  results: z.array(WorldSweepResultSchema),
})
export type WorldSweepResponse = z.infer<typeof WorldSweepResponseSchema>

// ===========================================================================
// Audit
// ===========================================================================

export const AuditEntrySchema = z.object({
  id: z.string(),
  run_id: z.string(),
  risk_event_id: z.string().nullable(),
  customer_id: z.string().nullable(),
  stage: AuditStageSchema,
  summary: z.string(),
  detail: z.unknown(), // JSONB, deliberately untyped — arbitrary structured payload
  actor: AuditActorSchema,
  sim_time: IsoDateTime,
  wall_time: IsoDateTime,
  prev_hash: z.string(),
  hash: z.string(),
})
export type AuditEntry = z.infer<typeof AuditEntrySchema>

export const AuditListResponseSchema = z.object({
  items: z.array(AuditEntrySchema),
  next_cursor: z.string().nullable(),
})
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>

// ASSUMED: 8.4's example only shows the "intact" case. `broken_at_entry` is
// inferred from 9.6's prose ("reports intact/broken... 'Broken at entry
// 3,180.'") — the field name and nullability are a guess. See question list.
export const AuditVerifyResponseSchema = z.object({
  intact: z.boolean(),
  entries_checked: z.number().int(),
  broken_at_entry: z.number().int().nullable(),
})
export type AuditVerifyResponse = z.infer<typeof AuditVerifyResponseSchema>

// ===========================================================================
// Model versions
// ===========================================================================

// ASSUMED: `name` in 5.4 is written with the same enum convention as every
// other column ("`p_baseline` | `p_recover_nudge_free` | ...") but ends in an
// explicit ellipsis — the full set of ~7 model names (one per T-learner arm
// plus p_optout) is never enumerated. `algo` shows only one example value
// ("hist_gradient_boosting") with no pipe-separated alternatives, so it's
// unclear whether it's a closed enum at all. Both left as z.string() in
// violation of the "no z.string() for enums" rule, specifically because the
// enum membership is incomplete/unclear rather than unspecified. See question list.
export const ModelVersionSchema = z.object({
  id: z.string(),
  name: z.string(),
  algo: z.string(),
  trained_at: IsoDateTime,
  train_rows: z.number().int(),
  metrics: z.record(z.string(), z.number()), // ASSUMED loose — see question list
  feature_names: z.array(z.string()),
  artifact_path: z.string(),
})
export type ModelVersion = z.infer<typeof ModelVersionSchema>

// ===========================================================================
// Dev endpoints
// ===========================================================================

// ASSUMED loose — dev-only seeding endpoint, `config` shape not specified.
export const DevSeedRequestSchema = z.object({
  config: z.unknown(),
})
export type DevSeedRequest = z.infer<typeof DevSeedRequestSchema>

// ===========================================================================
// SSE event payloads (section 8.5)
// ===========================================================================

export const RunProgressTickSchema = z.object({
  sim_day: z.number().int(),
  events_processed: z.number().int(),
  events_total: z.number().int(),
  speed: z.number(),
})
export type RunProgressTick = z.infer<typeof RunProgressTickSchema>

// ASSUMED: the example elides the customer object as `{...}`. Assuming the
// same shape as CaseListItem.customer. See question list.
export const CaseDetectedEventSchema = z.object({
  id: z.string(),
  customer: CaseCustomerSchema,
  kind: RiskEventKindSchema,
  value_at_risk_paise: Paise,
  arm: ArmSchema,
})
export type CaseDetectedEvent = z.infer<typeof CaseDetectedEventSchema>

// ASSUMED: `margin_protected_paise` is only meaningful for HOLD decisions
// (5.4: "If HOLD: what we avoided spending"). Modeled as nullable for the
// non-HOLD case rather than guessing it's always present. See question list.
export const CaseDecidedEventSchema = z.object({
  id: z.string(),
  action: ActionSchema,
  reason_code: ReasonCodeSchema,
  margin_protected_paise: Paise.nullable(),
  best_ev_paise: Paise,
})
export type CaseDecidedEvent = z.infer<typeof CaseDecidedEventSchema>

// ASSUMED: `channel` is only meaningful for message-type actions (NUDGE_*),
// not RETRY_*/ESCALATE_HUMAN. Modeled as nullable. See question list.
export const CaseActedEventSchema = z.object({
  id: z.string(),
  action_id: z.string(),
  type: ActionSchema,
  channel: ChannelSchema.nullable(),
  cost_paise: Paise,
})
export type CaseActedEvent = z.infer<typeof CaseActedEventSchema>

export const CaseOutcomeEventSchema = z.object({
  id: z.string(),
  resolution_path: ResolutionPathSchema,
  net_profit_paise: Paise,
  incremental_profit_paise: Paise,
})
export type CaseOutcomeEvent = z.infer<typeof CaseOutcomeEventSchema>

export const GuardrailBlockedEventSchema = z.object({
  id: z.string(),
  action: ActionSchema,
  policy_id: z.string(),
  policy_name: z.string(),
})
export type GuardrailBlockedEvent = z.infer<typeof GuardrailBlockedEventSchema>

export const FarmingEscalatedEventSchema = z.object({
  customer_id: z.string(),
  display_name: z.string(),
  from_tier: FarmingTierSchema,
  to_tier: FarmingTierSchema,
  score: Probability,
})
export type FarmingEscalatedEvent = z.infer<typeof FarmingEscalatedEventSchema>

// ASSUMED: the example shows only these 3 fields for `agent`/`baseline` (with
// `baseline` itself elided as `{...}`), and no `holdout` key at all — modeled
// as a lightweight tick subset with only agent+baseline, not the full
// ArmMetrics shape and not including holdout. See question list.
export const MetricsTickArmSchema = z.object({
  net_profit_paise: Paise,
  margin_protected_paise: Paise,
  holds: z.number().int(),
})
export type MetricsTickArm = z.infer<typeof MetricsTickArmSchema>

export const MetricsTickEventSchema = z.object({
  agent: MetricsTickArmSchema,
  baseline: MetricsTickArmSchema,
})
export type MetricsTickEvent = z.infer<typeof MetricsTickEventSchema>

// ASSUMED: `summary` is elided as `{...}`; assuming it's the run's final
// RunMetrics object (consistent with 5.4 runs.summary: "Cached final
// metrics"). See question list.
export const RunCompletedEventSchema = z.object({
  run_id: z.string(),
  summary: RunMetricsSchema,
})
export type RunCompletedEvent = z.infer<typeof RunCompletedEventSchema>

// Map of SSE event name -> payload schema, for use by SseRunStream/MockRunStream.
export const runStreamEventSchemas = {
  'run.progress': RunProgressTickSchema,
  'case.detected': CaseDetectedEventSchema,
  'case.decided': CaseDecidedEventSchema,
  'case.acted': CaseActedEventSchema,
  'case.outcome': CaseOutcomeEventSchema,
  'guardrail.blocked': GuardrailBlockedEventSchema,
  'farming.escalated': FarmingEscalatedEventSchema,
  'metrics.tick': MetricsTickEventSchema,
  'run.completed': RunCompletedEventSchema,
} as const
export type RunStreamEventName = keyof typeof runStreamEventSchemas
