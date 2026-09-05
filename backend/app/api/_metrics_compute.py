"""
Shared RunMetrics computation (the Ledger screen, 8.4) — real numbers pulled
from the run's own DB rows across all three arms, not fabricated. Reuses
stage 4's actual Qini/calibration functions (app/ml/qini.py, calibrate.py)
against this run's own decision_candidates and outcomes, rather than
inventing a chart.
"""

import numpy as np
from sqlmodel import Session, select

from app.ml.calibrate import reliability_diagram
from app.ml.qini import qini_coefficient, qini_curve
from app.models.actions import ActionRecord, Message
from app.models.decisions import Decision, DecisionCandidate
from app.models.enums import Action, ActionStatus, Arm
from app.models.outcomes import Outcome
from app.models.risk_events import RiskEvent
from app.models.runs import Run
from app.schemas.metrics import (
    ArmMetrics,
    CalibrationPoint,
    Qini,
    QiniPoint,
    RunMetrics,
    RunMetricsArms,
    RunMetricsDeltas,
    RunMetricsSeriesPoint,
)

_EMPTY_ARM = ArmMetrics(
    events=0, value_at_risk_paise=0, recovered_paise=0, spend_paise=0, net_profit_paise=0, incremental_profit_paise=0,
    recovery_rate=0.0, actions_taken=0, holds=0, margin_protected_paise=0, optouts=0, messages_sent=0,
)


def _arm_metrics(events: list[RiskEvent], outcomes: list[Outcome], decisions: list[Decision], actions: list[ActionRecord], messages: list[Message]) -> ArmMetrics:
    if not events:
        return _EMPTY_ARM
    event_ids = {e.id for e in events}
    arm_outcomes = [o for o in outcomes if o.risk_event_id in event_ids]
    arm_decisions = [d for d in decisions if d.risk_event_id in event_ids]
    arm_action_ids = {a.id for a in actions if a.risk_event_id in event_ids}
    arm_messages = [m for m in messages if m.action_id in arm_action_ids]

    resolved = [o for o in arm_outcomes if o.resolved]
    return ArmMetrics(
        events=len(events),
        value_at_risk_paise=sum(e.value_at_risk_paise for e in events),
        recovered_paise=sum(o.recovered_paise for o in arm_outcomes),
        spend_paise=sum(o.total_cost_paise for o in arm_outcomes),
        net_profit_paise=sum(o.net_profit_paise for o in arm_outcomes),
        incremental_profit_paise=sum(o.incremental_profit_paise for o in arm_outcomes),
        recovery_rate=(len(resolved) / len(arm_outcomes)) if arm_outcomes else 0.0,
        actions_taken=sum(1 for a in actions if a.risk_event_id in event_ids and a.status in (ActionStatus.EXECUTED, ActionStatus.CANCELLED)),
        holds=sum(1 for d in arm_decisions if d.chosen_action == Action.HOLD),
        margin_protected_paise=sum(d.hold_margin_protected_paise or 0 for d in arm_decisions if d.chosen_action == Action.HOLD),
        optouts=sum(1 for o in arm_outcomes if o.customer_opted_out),
        messages_sent=len(arm_messages),
    )


def _series(events: list[RiskEvent], outcomes_by_event: dict[str, Outcome], run: Run) -> list[RunMetricsSeriesPoint]:
    cumulative = {Arm.AGENT: 0, Arm.BASELINE: 0, Arm.HOLDOUT: 0}
    daily = {Arm.AGENT: [0] * run.sim_days, Arm.BASELINE: [0] * run.sim_days, Arm.HOLDOUT: [0] * run.sim_days}
    for event in events:
        outcome = outcomes_by_event.get(event.id)
        if outcome is None:
            continue
        day_index = min(max((outcome.resolved_at_sim - run.started_at).days, 0), run.sim_days - 1)
        daily[event.arm][day_index] += outcome.net_profit_paise

    points = []
    for day in range(run.sim_days):
        for arm in (Arm.AGENT, Arm.BASELINE, Arm.HOLDOUT):
            cumulative[arm] += daily[arm][day]
        points.append(
            RunMetricsSeriesPoint(sim_day=day + 1, agent_net_paise=cumulative[Arm.AGENT], baseline_net_paise=cumulative[Arm.BASELINE], holdout_net_paise=cumulative[Arm.HOLDOUT])
        )
    return points


def _qini(agent_decisions: list[Decision], outcomes_by_event: dict[str, Outcome]) -> Qini:
    """
    Treatment/control *within* the agent arm (acted vs. held), scored by the
    engine's own `best_ev_paise` — not a true randomised-control Qini (that
    would need the holdout arm scored by the same model, which never runs
    decide() at all), but a real computation against this run's own data,
    reusing stage 4's actual qini_curve/qini_coefficient rather than a chart
    with invented numbers.
    """
    rows = [(d, outcomes_by_event[d.risk_event_id]) for d in agent_decisions if d.risk_event_id in outcomes_by_event]
    if len(rows) < 5:
        return Qini(coefficient=0.0, points=[])

    y_true = np.array([1.0 if o.resolved else 0.0 for _, o in rows])
    treatment = np.array([d.chosen_action != Action.HOLD for d, _ in rows])
    uplift_score = np.array([float(d.best_ev_paise) for d, _ in rows])
    if not treatment.any() or treatment.all():
        return Qini(coefficient=0.0, points=[])

    curve = qini_curve(y_true, treatment, uplift_score, n_points=20)
    coefficient = qini_coefficient(curve)
    endpoint = curve[-1].incremental_responders if curve else 0.0
    points = [QiniPoint(fraction=p.fraction, agent=p.incremental_responders, random=p.fraction * endpoint) for p in curve]
    return Qini(coefficient=coefficient, points=points)


def _calibration(session: Session, agent_decisions: list[Decision], outcomes_by_event: dict[str, Outcome]) -> list[CalibrationPoint]:
    decisions_by_id = {d.id: d for d in agent_decisions}
    if not decisions_by_id:
        return []
    candidates = session.exec(select(DecisionCandidate).where(DecisionCandidate.decision_id.in_(decisions_by_id.keys()))).all()

    pairs: list[tuple[float, float]] = []
    for c in candidates:
        decision = decisions_by_id.get(c.decision_id)
        if decision is None or c.action != decision.chosen_action:
            continue
        outcome = outcomes_by_event.get(decision.risk_event_id)
        if outcome is None:
            continue
        pairs.append((float(c.p_recover), 1.0 if outcome.resolved else 0.0))

    if len(pairs) < 5:
        return []
    predicted = np.array([p for p, _ in pairs])
    actual = np.array([a for _, a in pairs])
    bins = reliability_diagram(actual, predicted, n_bins=10)
    return [CalibrationPoint(predicted=round(b.predicted_mean, 4), observed=round(b.actual_rate, 4), n=b.count) for b in bins if b.count > 0]


def compute_run_metrics(session: Session, run: Run) -> RunMetrics:
    events = session.exec(select(RiskEvent).where(RiskEvent.run_id == run.id)).all()
    event_ids = [e.id for e in events]
    outcomes = session.exec(select(Outcome).where(Outcome.risk_event_id.in_(event_ids))).all() if event_ids else []
    decisions = session.exec(select(Decision).where(Decision.risk_event_id.in_(event_ids))).all() if event_ids else []
    actions = session.exec(select(ActionRecord).where(ActionRecord.risk_event_id.in_(event_ids))).all() if event_ids else []
    messages = session.exec(select(Message).where(Message.action_id.in_([a.id for a in actions]))).all() if actions else []

    outcomes_by_event = {o.risk_event_id: o for o in outcomes}
    events_by_arm = {arm: [e for e in events if e.arm == arm] for arm in (Arm.AGENT, Arm.BASELINE, Arm.HOLDOUT)}

    arms = RunMetricsArms(
        agent=_arm_metrics(events_by_arm[Arm.AGENT], outcomes, decisions, actions, messages),
        baseline=_arm_metrics(events_by_arm[Arm.BASELINE], outcomes, decisions, actions, messages),
        holdout=_arm_metrics(events_by_arm[Arm.HOLDOUT], outcomes, decisions, actions, messages),
    )

    agent, baseline = arms.agent, arms.baseline
    deltas = RunMetricsDeltas(
        net_profit_vs_baseline_paise=agent.net_profit_paise - baseline.net_profit_paise,
        net_profit_vs_baseline_pct=((agent.net_profit_paise - baseline.net_profit_paise) / abs(baseline.net_profit_paise)) if baseline.net_profit_paise else 0.0,
        spend_reduction_pct=(1 - agent.spend_paise / baseline.spend_paise) if baseline.spend_paise else 0.0,
        recovery_rate_delta=round(agent.recovery_rate - baseline.recovery_rate, 4),
    )

    agent_decisions = [d for d in decisions if d.risk_event_id in {e.id for e in events_by_arm[Arm.AGENT]}]

    return RunMetrics(
        run_id=run.id,
        arms=arms,
        deltas=deltas,
        series=_series(events, outcomes_by_event, run),
        qini=_qini(agent_decisions, outcomes_by_event),
        calibration=_calibration(session, agent_decisions, outcomes_by_event),
    )
