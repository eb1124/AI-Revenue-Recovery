"""
Cases — the live feed and the trace screen (section 8.4). Only risk_events
that have reached a terminal outcome are listed here (every code path that
reaches one — agent/baseline/holdout arms, and the never-started/
edge-too-thin path — diagnoses and decides first, so decision/outcome/
cause_code are always real and non-null here, matching schemas.ts's
CaseListItem exactly). An in-flight event with no outcome yet simply isn't
listed; the SSE stream (case.detected) is what shows those.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.agent.farming import compute_farming_score
from app.audit import append_entry
from app.db import get_session
from app.llm.narrate import generate_narrative
from app.models.actions import ActionRecord, Message
from app.models.audit import AuditEntry
from app.models.billing import CheckoutSession
from app.models.customers import Customer
from app.models.decisions import Decision, DecisionCandidate
from app.models.enums import (
    Action,
    Arm,
    AuditActor,
    AuditStage,
    CauseCode,
    CheckoutStage,
    DecidedBy,
    ReasonCode,
    RiskEventStatus,
)
from app.models.ml import ModelVersion
from app.models.outcomes import Outcome
from app.models.risk_events import RiskEvent
from app.schemas.cases import (
    BlockedAction,
    Candidate,
    CaseAction,
    CaseAuditTrailEntry,
    CaseCustomer,
    CaseDecision,
    CaseDecisionSummary,
    CaseDetail,
    CaseListItem,
    CaseMessage,
    CaseNarrativeResponse,
    CaseOutcome,
    CaseOutcomeSummary,
    CaseOverrideRequest,
    CasesListResponse,
    CustomerContext,
    Diagnosis,
    Evidence,
    FarmingSignals,
    RecentEvent,
    Scoring,
    TopFeature,
)
from app.schemas.common import iso_z
from app.sim.decline_codes import DECLINE_CODES

router = APIRouter(prefix="/api/cases", tags=["cases"])


def _format_duration(start: datetime, end: datetime) -> str:
    hours = (end - start).total_seconds() / 3600
    if hours < 1:
        return f"{max(int(hours * 60), 1)}m"
    h, m = int(hours), int((hours % 1) * 60)
    return f"{h}h {m}m" if m else f"{h}h"


def _headline(event: RiskEvent, decision: Decision, outcome: Outcome) -> str:
    duration = _format_duration(event.detected_at_sim, outcome.resolved_at_sim)
    if decision.chosen_action == Action.HOLD:
        if outcome.resolved:
            return f"Returned on their own in {duration}. We spent nothing."
        return f"Never resolved ({outcome.resolution_path.value}) — the arithmetic said not to chase it."
    if outcome.resolved:
        return f"Recovered via {decision.chosen_action.value} in {duration}. Net profit Rs{outcome.net_profit_paise / 100:,.0f}."
    return f"{decision.chosen_action.value} sent, but the balance was never recovered ({outcome.resolution_path.value})."


def _explanation(session: Session, event: RiskEvent, decision: Decision) -> str:
    if decision.decided_by == DecidedBy.HUMAN_OVERRIDE:
        override_entry = session.exec(
            select(AuditEntry).where(AuditEntry.risk_event_id == event.id, AuditEntry.stage == AuditStage.OVERRIDE).order_by(AuditEntry.id.desc())
        ).first()
        reason = override_entry.detail.get("reason", "") if override_entry else ""
        return f"Overridden by a human operator: {reason}" if reason else "Overridden by a human operator."
    by_reason = {
        ReasonCode.POSITIVE_EV: f"{decision.chosen_action.value} had the highest expected value (Rs{decision.best_ev_paise / 100:,.0f}), clearing the minimum edge required to act.",
        ReasonCode.NO_ACTION_BEATS_HOLD: "Every intervention costs more than the margin it would add. Holding was the best available option.",
        ReasonCode.UNCERTAIN_UPLIFT: f"The best candidate's confidence interval straddled zero (Rs{decision.best_ev_ci_low_paise / 100:,.0f} to Rs{decision.best_ev_ci_high_paise / 100:,.0f}) — not reliably positive, so we held.",
        ReasonCode.EDGE_TOO_THIN: f"The best edge (Rs{decision.best_ev_paise / 100:,.0f}) was below the minimum threshold required to justify contacting the customer.",
        ReasonCode.POLICY_BLOCKED: "A guardrail policy removed the highest-EV action from consideration, so we held instead.",
        ReasonCode.HIGH_VALUE_AMBIGUOUS: f"This case is high-value (Rs{event.value_at_risk_paise / 100:,.0f}) with genuinely uncertain uplift, so it was escalated to a human rather than decided automatically.",
    }
    return by_reason.get(decision.reason_code, "Decided by the engine.")


def _to_case_customer(customer: Customer) -> CaseCustomer:
    return CaseCustomer(id=customer.id, display_name=customer.display_name, segment=customer.segment, farming_tier=customer.farming_tier, city=customer.city)


def _to_list_item(session: Session, event: RiskEvent, decision: Decision, outcome: Outcome) -> CaseListItem:
    customer = session.get(Customer, event.customer_id)
    return CaseListItem(
        id=event.id,
        customer=_to_case_customer(customer),
        kind=event.kind,
        value_at_risk_paise=event.value_at_risk_paise,
        cause_code=event.cause_code,
        cause_confidence=float(event.cause_confidence or 0),
        status=event.status,
        arm=event.arm,
        decision=CaseDecisionSummary(
            action=decision.chosen_action, reason_code=decision.reason_code, best_ev_paise=decision.best_ev_paise, margin_protected_paise=decision.hold_margin_protected_paise or 0
        ),
        outcome=CaseOutcomeSummary(resolution_path=outcome.resolution_path, net_profit_paise=outcome.net_profit_paise),
        detected_at_sim=iso_z(event.detected_at_sim),
        headline=_headline(event, decision, outcome),
    )


@router.get("", response_model=CasesListResponse)
def list_cases(
    run_id: str | None = None,
    arm: Arm | None = None,
    status: RiskEventStatus | None = None,
    decision: Action | None = None,
    cause: CauseCode | None = None,
    min_value: int | None = None,
    q: str | None = None,
    cursor: str | None = None,
    limit: int = Query(50, le=1000),
    session: Session = Depends(get_session),
) -> CasesListResponse:
    query = select(RiskEvent).where(RiskEvent.id.in_(select(Outcome.risk_event_id)))
    if run_id:
        query = query.where(RiskEvent.run_id == run_id)
    if arm:
        query = query.where(RiskEvent.arm == arm)
    if status:
        query = query.where(RiskEvent.status == status)
    if cause:
        query = query.where(RiskEvent.cause_code == cause)
    if min_value is not None:
        query = query.where(RiskEvent.value_at_risk_paise >= min_value)

    events = session.exec(query.order_by(RiskEvent.id.desc())).all()

    items = []
    for event in events:
        d = session.exec(select(Decision).where(Decision.risk_event_id == event.id)).first()
        o = session.exec(select(Outcome).where(Outcome.risk_event_id == event.id)).first()
        if d is None or o is None:
            continue
        if decision is not None and d.chosen_action != decision:
            continue
        items.append(_to_list_item(session, event, d, o))

    if q:
        ql = q.lower().strip()
        items = [i for i in items if ql in i.customer.display_name.lower() or ql in i.customer.city.lower() or ql in i.id.lower()]

    offset = int(cursor) if cursor else 0
    page = items[offset : offset + limit]
    next_cursor = str(offset + limit) if offset + limit < len(items) else None
    return CasesListResponse(items=page, next_cursor=next_cursor)


def _customer_context(session: Session, event: RiskEvent, customer: Customer) -> CustomerContext:
    since_90d = event.detected_at_sim - timedelta(days=90)
    checkouts_90d = session.exec(select(CheckoutSession).where(CheckoutSession.customer_id == customer.id, CheckoutSession.started_at >= since_90d)).all()
    abandon_rate_90d = (sum(1 for c in checkouts_90d if c.stage == CheckoutStage.ABANDONED) / len(checkouts_90d)) if checkouts_90d else 0.0

    since_7d = event.detected_at_sim - timedelta(days=7)
    sent_7d = session.exec(
        select(Message)
        .join(ActionRecord, Message.action_id == ActionRecord.id)
        .join(RiskEvent, ActionRecord.risk_event_id == RiskEvent.id)
        .where(RiskEvent.customer_id == customer.id, Message.sent_at_sim.is_not(None), Message.sent_at_sim >= since_7d, Message.sent_at_sim < event.detected_at_sim)
    ).all()

    farming = compute_farming_score(session, customer.id, event.detected_at_sim)
    signals = farming.signals or {"abandon_rate": 0.0, "post_incentive_conversion_rate": 0.0, "incentive_dependency": 0.0, "timing_regularity": 0.0, "stage_consistency": 0.0}

    other_events = session.exec(select(RiskEvent).where(RiskEvent.customer_id == customer.id, RiskEvent.id != event.id).order_by(RiskEvent.id.desc()).limit(5)).all()
    recent_events = []
    for e in other_events:
        d = session.exec(select(Decision).where(Decision.risk_event_id == e.id)).first()
        o = session.exec(select(Outcome).where(Outcome.risk_event_id == e.id)).first()
        if d is None or o is None:
            continue
        recent_events.append(RecentEvent(id=e.id, kind=e.kind, action=d.chosen_action, outcome=o.resolution_path, at=iso_z(e.detected_at_sim)))

    return CustomerContext(
        tenure_days=(event.detected_at_sim - customer.signup_at).days,
        ltv_expected_paise=customer.ltv_expected_paise,
        gross_margin_bps=customer.gross_margin_bps,
        abandon_rate_90d=round(abandon_rate_90d, 4),
        messages_received_7d=len(sent_7d),
        inferred_salary_day=customer.inferred_salary_day,
        farming_score=float(customer.farming_score),
        farming_signals=FarmingSignals(
            abandon_rate=signals.get("abandon_rate", 0.0),
            post_incentive_conversion=signals.get("post_incentive_conversion_rate", 0.0),
            incentive_dependency=signals.get("incentive_dependency", 0.0),
            timing_regularity=signals.get("timing_regularity", 0.0),
            stage_consistency=signals.get("stage_consistency", 0.0),
        ),
        recent_events=recent_events,
    )


def _p_baseline_ci(p_baseline: float) -> tuple[float, float]:
    """
    Approximate: 5.4's `decisions` table stores `p_baseline` as a point
    estimate only (unlike `best_ev_ci_low/high_paise`, which are real,
    persisted columns) — there is no per-decision bootstrap CI to read back.
    A narrow symmetric band around the point estimate, clamped to [0, 1].
    """
    return (round(max(0.0, p_baseline - 0.08), 3), round(min(1.0, p_baseline + 0.08), 3))


def _top_features(event: RiskEvent) -> list[TopFeature]:
    """
    Approximate — no per-decision SHAP/permutation importance is computed
    (out of scope for this build). cause_code's contribution is grounded in
    the real 6.3 self-recovery-rate spread, not invented.
    """
    features = []
    if event.cause_code and event.cause_code in DECLINE_CODES:
        info = DECLINE_CODES[event.cause_code]
        features.append(TopFeature(name=f"cause_code={event.cause_code.value}", contribution=round(info.self_recovery_rate - 0.25, 3)))
    features.append(TopFeature(name="value_at_risk_paise", contribution=round(min(event.value_at_risk_paise / 100_000, 1.0), 3)))
    return features


def _to_detail(session: Session, event: RiskEvent, decision: Decision, outcome: Outcome) -> CaseDetail:
    customer = session.get(Customer, event.customer_id)
    candidates = session.exec(select(DecisionCandidate).where(DecisionCandidate.decision_id == decision.id).order_by(DecisionCandidate.rank)).all()
    actions = session.exec(select(ActionRecord).where(ActionRecord.risk_event_id == event.id)).all()
    action_ids = [a.id for a in actions]
    messages = session.exec(select(Message).where(Message.action_id.in_(action_ids))).all() if action_ids else []
    audit_entries = session.exec(select(AuditEntry).where(AuditEntry.risk_event_id == event.id).order_by(AuditEntry.id)).all()

    p_baseline_model = session.exec(select(ModelVersion).where(ModelVersion.name == "p_baseline").order_by(ModelVersion.trained_at.desc())).first()
    model_version = f"p_baseline@{iso_z(p_baseline_model.trained_at)}" if p_baseline_model else "p_baseline@unknown"
    p_baseline = float(decision.p_baseline)

    blocked = [BlockedAction(action=Action(b["action"]), policy_id=b["policy_id"], policy_name=b["policy_name"]) for b in decision.blocked_actions]

    return CaseDetail(
        event=_to_list_item(session, event, decision, outcome),
        customer_context=_customer_context(session, event, customer),
        diagnosis=Diagnosis(
            cause_code=event.cause_code,
            confidence=float(event.cause_confidence or 0),
            narrative=event.cause_narrative,
            evidence=[Evidence(signal="decline_code", value=event.cause_code.value if event.cause_code else "unknown", weight=float(event.cause_confidence or 0))],
        ),
        scoring=Scoring(p_baseline=p_baseline, p_baseline_ci=_p_baseline_ci(p_baseline), model_version=model_version, top_features=_top_features(event)),
        candidates=[
            Candidate(
                action=c.action, p_recover=float(c.p_recover), uplift=float(c.uplift), gross_gain_paise=c.gross_gain_paise, direct_cost_paise=c.direct_cost_paise,
                incentive_cost_paise=c.incentive_cost_paise, annoyance_cost_paise=c.annoyance_cost_paise, farming_cost_paise=c.farming_cost_paise, ev_paise=c.ev_paise,
                ci_low_paise=c.ci_low_paise, ci_high_paise=c.ci_high_paise, allowed=c.allowed, block_reason=c.block_reason, rank=c.rank,
            )
            for c in candidates
        ],
        decision=CaseDecision(
            chosen_action=decision.chosen_action, reason_code=decision.reason_code, decided_by=decision.decided_by, latency_ms=decision.latency_ms,
            explanation=_explanation(session, event, decision), blocked_actions=blocked,
        ),
        actions=[
            CaseAction(
                id=a.id, decision_id=a.decision_id, risk_event_id=a.risk_event_id, type=a.type, params=a.params, scheduled_for_sim=iso_z(a.scheduled_for_sim),
                executed_at_sim=iso_z(a.executed_at_sim) if a.executed_at_sim else None, status=a.status, cancel_reason=a.cancel_reason, cost_paise=a.cost_paise,
            )
            for a in actions
        ],
        messages=[
            CaseMessage(
                id=m.id, action_id=m.action_id, channel=m.channel, language=m.language, body=m.body, incentive_bps=m.incentive_bps, tone=m.tone,
                policy_checks_passed=m.policy_checks_passed, sent_at_sim=iso_z(m.sent_at_sim) if m.sent_at_sim else None, opened=m.opened, clicked=m.clicked,
            )
            for m in messages
        ],
        outcome=CaseOutcome(
            resolution_path=outcome.resolution_path, recovered_paise=outcome.recovered_paise, total_cost_paise=outcome.total_cost_paise, net_profit_paise=outcome.net_profit_paise,
            counterfactual_recovered_paise=outcome.counterfactual_recovered_paise, incremental_profit_paise=outcome.incremental_profit_paise, resolved_at_sim=iso_z(outcome.resolved_at_sim),
        ),
        audit_trail=[CaseAuditTrailEntry(stage=e.stage, summary=e.summary, sim_time=iso_z(e.sim_time), actor=e.actor) for e in audit_entries],
    )


def _get_terminal_case(session: Session, case_id: str) -> tuple[RiskEvent, Decision, Outcome]:
    event = session.get(RiskEvent, case_id)
    if event is None:
        raise HTTPException(404, "case not found")
    decision = session.exec(select(Decision).where(Decision.risk_event_id == event.id)).first()
    outcome = session.exec(select(Outcome).where(Outcome.risk_event_id == event.id)).first()
    if decision is None or outcome is None:
        raise HTTPException(404, "case not yet resolved")
    return event, decision, outcome


@router.get("/{case_id}", response_model=CaseDetail)
def get_case(case_id: str, session: Session = Depends(get_session)) -> CaseDetail:
    event, decision, outcome = _get_terminal_case(session, case_id)
    return _to_detail(session, event, decision, outcome)


@router.post("/{case_id}/override", response_model=CaseDetail)
def override_case(case_id: str, body: CaseOverrideRequest, session: Session = Depends(get_session)) -> CaseDetail:
    event, decision, outcome = _get_terminal_case(session, case_id)

    decision.chosen_action = body.action
    decision.chosen_params = body.params
    decision.decided_by = DecidedBy.HUMAN_OVERRIDE
    session.add(decision)
    session.commit()

    append_entry(
        session, run_id=event.run_id, stage=AuditStage.OVERRIDE, actor=AuditActor.HUMAN, sim_time=outcome.resolved_at_sim,
        summary=f"Overridden to {body.action.value}: {body.reason}", detail={"reason": body.reason}, risk_event_id=event.id, customer_id=event.customer_id,
    )

    session.refresh(decision)
    return _to_detail(session, event, decision, outcome)


@router.get("/{case_id}/narrative", response_model=CaseNarrativeResponse)
def get_case_narrative(case_id: str, session: Session = Depends(get_session)) -> CaseNarrativeResponse:
    event = session.get(RiskEvent, case_id)
    if event is None:
        raise HTTPException(404, "case not found")
    actions = session.exec(select(ActionRecord).where(ActionRecord.risk_event_id == event.id)).all()
    attempt_number = len(actions) + 1
    narrative = generate_narrative(event.cause_code, attempt_number, {"customer_id": event.customer_id, "value_at_risk_paise": event.value_at_risk_paise})
    return CaseNarrativeResponse(narrative=narrative)
