"""Cases — the live feed and the trace screen (section 8.4)."""

from typing import Any

from pydantic import BaseModel

from app.models.enums import (
    Action,
    ActionStatus,
    Arm,
    AuditActor,
    AuditStage,
    CauseCode,
    Channel,
    DecidedBy,
    FarmingTier,
    Language,
    ReasonCode,
    ResolutionPath,
    RiskEventKind,
    RiskEventStatus,
    Segment,
    Tone,
)


class CaseCustomer(BaseModel):
    id: str
    display_name: str
    segment: Segment
    farming_tier: FarmingTier
    city: str


class CaseDecisionSummary(BaseModel):
    action: Action
    reason_code: ReasonCode
    best_ev_paise: int
    # Not nullable in schemas.ts's CaseListItem (unlike the SSE case.decided
    # event's own copy of this field, which is) — coerced to 0 for non-HOLD
    # decisions at the router (5.4: only meaningful "if HOLD", but the list
    # item's own contract wants a number here regardless).
    margin_protected_paise: int


class CaseOutcomeSummary(BaseModel):
    resolution_path: ResolutionPath
    net_profit_paise: int


class CaseListItem(BaseModel):
    id: str
    customer: CaseCustomer
    kind: RiskEventKind
    value_at_risk_paise: int
    # Not nullable, matching schemas.ts's CaseListItemSchema exactly — safe
    # because /api/cases only ever lists risk_events that have reached a
    # terminal outcome (see app/api/cases.py), and every code path that
    # reaches one (agent/baseline/holdout arms, and the never-started/
    # edge-too-thin path) diagnoses and decides first. An in-flight event
    # with no cause_code/decision/outcome yet simply isn't listed here —
    # the SSE stream (case.detected) is what shows those.
    cause_code: CauseCode
    cause_confidence: float
    status: RiskEventStatus
    arm: Arm
    decision: CaseDecisionSummary
    outcome: CaseOutcomeSummary
    detected_at_sim: str
    headline: str


class CasesListResponse(BaseModel):
    items: list[CaseListItem]
    next_cursor: str | None


class FarmingSignals(BaseModel):
    abandon_rate: float
    post_incentive_conversion: float
    incentive_dependency: float
    timing_regularity: float
    stage_consistency: float


class RecentEvent(BaseModel):
    id: str
    kind: RiskEventKind
    action: Action
    outcome: ResolutionPath
    at: str


class CustomerContext(BaseModel):
    tenure_days: int
    ltv_expected_paise: int
    gross_margin_bps: int
    abandon_rate_90d: float
    messages_received_7d: int
    inferred_salary_day: int | None
    farming_score: float
    farming_signals: FarmingSignals
    recent_events: list[RecentEvent]


class Evidence(BaseModel):
    signal: str
    value: str
    weight: float


class Diagnosis(BaseModel):
    cause_code: CauseCode | None
    confidence: float
    narrative: str | None
    evidence: list[Evidence]


class TopFeature(BaseModel):
    name: str
    contribution: float


class Scoring(BaseModel):
    p_baseline: float
    p_baseline_ci: tuple[float, float]
    model_version: str
    top_features: list[TopFeature]


class Candidate(BaseModel):
    action: Action
    p_recover: float
    uplift: float
    gross_gain_paise: int
    direct_cost_paise: int
    incentive_cost_paise: int
    annoyance_cost_paise: int
    farming_cost_paise: int
    ev_paise: int
    ci_low_paise: int
    ci_high_paise: int
    allowed: bool
    block_reason: str | None
    rank: int


class BlockedAction(BaseModel):
    action: Action
    policy_id: str
    policy_name: str


class CaseDecision(BaseModel):
    chosen_action: Action
    reason_code: ReasonCode
    decided_by: DecidedBy
    latency_ms: int
    explanation: str
    blocked_actions: list[BlockedAction]


class CaseAction(BaseModel):
    id: str
    decision_id: str
    risk_event_id: str
    type: Action
    params: dict[str, Any]
    scheduled_for_sim: str
    executed_at_sim: str | None
    status: ActionStatus
    cancel_reason: str | None
    cost_paise: int


class CaseMessage(BaseModel):
    id: str
    action_id: str
    channel: Channel
    language: Language
    body: str
    incentive_bps: int
    tone: Tone
    policy_checks_passed: list[dict[str, Any]]
    sent_at_sim: str | None
    opened: bool
    clicked: bool


class CaseOutcome(BaseModel):
    resolution_path: ResolutionPath
    recovered_paise: int
    total_cost_paise: int
    net_profit_paise: int
    counterfactual_recovered_paise: int
    incremental_profit_paise: int
    resolved_at_sim: str


class CaseAuditTrailEntry(BaseModel):
    stage: AuditStage
    summary: str
    sim_time: str
    actor: AuditActor


class CaseDetail(BaseModel):
    event: CaseListItem
    customer_context: CustomerContext
    diagnosis: Diagnosis
    scoring: Scoring
    candidates: list[Candidate]
    decision: CaseDecision
    actions: list[CaseAction]
    messages: list[CaseMessage]
    outcome: CaseOutcome  # always present — see CaseListItem's comment on why
    audit_trail: list[CaseAuditTrailEntry]


class CaseOverrideRequest(BaseModel):
    action: Action
    params: dict[str, Any]
    reason: str


class CaseNarrativeResponse(BaseModel):
    narrative: str
