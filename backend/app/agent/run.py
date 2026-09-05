"""
The live agent loop, standalone-runnable (session-12 stage 5 brief) and
API-drivable (stage 7):

    python -m app.agent.run --seed 42 --days 30

This is the harness: it is the ONLY module in the whole backend allowed to
see both the agent's decisions (detect -> diagnose -> score -> decide -> act)
AND the simulator's ground truth (SimCustomer/archetype, via oracle.py) —
exactly the boundary sim/oracle.py's docstring describes ("ground truth the
agent never sees"). It plays the role a real payment gateway's webhooks and
a real customer's actual behaviour would play in production: `act.py` only
ever *dispatches* an action; this file decides what really happens next and
writes that back to the DB as if a webhook had arrived, which `verify.py`
then picks up using nothing but observable state.

Stage 7 adds multi-arm support (`run.arms`, section 3.2/5.4): each newly
detected event is randomly assigned to one of the run's requested arms.
`agent` gets the full EV-driven pipeline (unchanged from stage 5/6); `baseline`
is a real, simple, non-restrained fixed policy (still guardrail-compliant —
even a naive system doesn't text people who opted out); `holdout` is the
pure implicit-HOLD path (no agent, no action, self-recovery only). All three
are genuinely simulated, not fabricated, so the Ledger screen's 3-arm
comparison (8.4 RunMetrics) is real data. `create_run`/`execute_run` are
split so the API layer (POST /api/runs) can create the DB row synchronously
and run the heavy loop on a background thread.
"""

import argparse
import random
import time
from dataclasses import asdict
from datetime import datetime, timedelta
from decimal import Decimal

from sqlmodel import Session, select

from app.agent.act import act
from app.agent.decide import decide
from app.agent.detect import detect_new_risk_events
from app.agent.diagnose import diagnose
from app.agent.policy import Policy, cancel_scheduled_actions, contact_counts, policy_filter, seed_policies
from app.agent.run_registry import clear_progress, set_progress
from app.agent.score import build_feature_inputs, load_default_bundle, score_events_batch
from app.agent.verify import attribute_outcome
from app.audit import append_entry, verify_chain
from app.config import settings
from app.db import create_all, engine
from app.models.actions import ActionRecord
from app.models.billing import CheckoutSession, PaymentAttempt, Subscription
from app.models.decisions import Decision
from app.models.enums import (
    Action,
    ActionStatus,
    Arm,
    AuditActor,
    AuditStage,
    Channel,
    CheckoutStage,
    DecidedBy,
    Gateway,
    Issuer,
    PaymentAttemptStatus,
    ReasonCode,
    RiskEventKind,
    RiskEventStatus,
    RunStatus,
    SubscriptionStatus,
    TriggeredBy,
    WorldConfigName,
)
from app.models.outcomes import Outcome
from app.models.risk_events import RiskEvent
from app.models.runs import Run, WorldConfig
from app.sim.events import generate_checkout_event, generate_renewal_event
from app.sim.oracle import p_optout, resolve_paired_outcome
from app.sim.population import SimCustomer, generate_population
from app.sim.sweep import CHECKOUT_DAILY_PROBABILITY
from app.sim.world_params import WorldParams

# Deliberately naive, unlike sim/run.py's and ml/train.py's tz-aware
# SIM_START — SQLite (this environment's fallback DB, 5.1) silently drops
# tzinfo on every round-trip through SQLAlchemy's post-commit attribute
# refresh, and this module is the first one that re-queries the DB and
# compares timestamps against a live-updating `now` in the same process.
# Naive throughout avoids a whole class of "can't subtract offset-naive and
# offset-aware datetimes" crashes rather than patching every comparison site.
SIM_START = datetime(2026, 8, 1)  # noqa: DTZ001 — intentionally naive, see comment above; matches sim/run.py's and ml/train.py's calendar date (6.6: this is "day 0" of the live phase)

_PAUSE_POLL_SECONDS = 0.5


# --- oracle injection: standing in for real gateway webhooks / customer behaviour --------------


def _next_attempt_number(session: Session, risk_event: RiskEvent) -> int:
    column = PaymentAttempt.checkout_session_id if risk_event.kind == RiskEventKind.ABANDONED_CHECKOUT else PaymentAttempt.subscription_id
    return len(session.exec(select(PaymentAttempt).where(column == risk_event.source_id)).all()) + 1


def _mark_paid(session: Session, risk_event: RiskEvent, sim_customer: SimCustomer, completed_at: datetime, rng: random.Random) -> None:
    attempt_number = _next_attempt_number(session, risk_event)
    if risk_event.kind == RiskEventKind.ABANDONED_CHECKOUT:
        checkout = session.get(CheckoutSession, risk_event.source_id)
        checkout.stage, checkout.completed_at = CheckoutStage.PAID, completed_at
        session.add(checkout)
        attempt = PaymentAttempt(
            customer_id=sim_customer.row.id, checkout_session_id=checkout.id, amount_paise=checkout.cart_value_paise, method=checkout.payment_method.value,
            gateway=rng.choice(list(Gateway)), issuer=rng.choice(list(Issuer)), status=PaymentAttemptStatus.SUCCESS,
            attempt_number=attempt_number, triggered_by=TriggeredBy.AGENT_RETRY, attempted_at=completed_at,
        )
    else:
        subscription = session.get(Subscription, risk_event.source_id)
        subscription.status, subscription.consecutive_failures = SubscriptionStatus.ACTIVE, 0
        session.add(subscription)
        attempt = PaymentAttempt(
            customer_id=sim_customer.row.id, subscription_id=subscription.id, amount_paise=subscription.mrr_paise, method=subscription.mandate_type.value,
            gateway=rng.choice(list(Gateway)), issuer=rng.choice(list(Issuer)), status=PaymentAttemptStatus.SUCCESS,
            attempt_number=attempt_number, triggered_by=TriggeredBy.AGENT_RETRY, attempted_at=completed_at,
        )
    session.add(attempt)
    session.commit()


def resolve_and_inject(
    session: Session,
    sim_customer: SimCustomer,
    risk_event: RiskEvent,
    action: Action,
    reference_time: datetime,
    params: WorldParams,
    rng: random.Random,
    messages_sent_7d: int,
    original_event_time: datetime | None = None,
) -> tuple[bool, int]:
    """Returns (opted_out, counterfactual_recovered_paise) for verify.attribute_outcome."""
    original_event_time = original_event_time or reference_time
    cause_code = risk_event.cause_code
    outcome = resolve_paired_outcome(cause_code, sim_customer, action, reference_time, params, rng, messages_sent_7d)
    counterfactual_recovered_paise = risk_event.value_at_risk_paise if outcome.hold_recovered else 0

    if action == Action.RETRY_SCHEDULED and outcome.hold_recovered:
        # The customer would have come back on their own well before the
        # scheduled retry fires — the cancel path 9.4 calls out explicitly.
        completed_at = original_event_time + timedelta(hours=outcome.hold_delay_hours)
        _mark_paid(session, risk_event, sim_customer, completed_at, rng)
        cancel_scheduled_actions(session, risk_event.id, "customer self-recovered before the scheduled retry")
    elif outcome.chosen_recovered:
        completed_at = reference_time + timedelta(minutes=rng.uniform(1, 20)) if action == Action.RETRY_SCHEDULED else reference_time + timedelta(hours=outcome.chosen_delay_hours)
        _mark_paid(session, risk_event, sim_customer, completed_at, rng)

    opted_out = False
    if action in (Action.NUDGE_FREE, Action.NUDGE_INCENTIVE, Action.ESCALATE_HUMAN):
        p_opt = p_optout(action, messages_sent_7d, (reference_time - sim_customer.row.signup_at).days, params)
        opted_out = rng.random() < p_opt
        if opted_out:
            sim_customer.row.hard_optout = True
            session.add(sim_customer.row)
            session.commit()

    return opted_out, counterfactual_recovered_paise


# --- per-event agent pipeline (the "agent" arm) --------------------------------------------------
#
# Split into a "prepare" phase (diagnose + feature-building — cheap, DB-only)
# and a "decide and act" phase (needs model scores) so a whole day's worth of
# new events can be scored in one batched call instead of one at a time —
# see score.score_events_batch's docstring for why that matters (a ~30x
# difference in wall-clock time, not a micro-optimisation).


def _log_outcome(session: Session, run_id: str, risk_event: RiskEvent, outcome, now: datetime) -> None:
    if outcome is None:
        return
    append_entry(
        session,
        run_id=run_id,
        stage=AuditStage.VERIFY,
        summary=f"{risk_event.kind.value} {'resolved' if outcome.resolved else 'closed'}: {outcome.resolution_path.value}, net profit Rs{outcome.net_profit_paise / 100:,.2f}",
        actor=AuditActor.SIMULATOR,
        sim_time=now,
        detail={"resolution_path": outcome.resolution_path.value, "net_profit_paise": outcome.net_profit_paise, "incremental_profit_paise": outcome.incremental_profit_paise},
        risk_event_id=risk_event.id,
        customer_id=risk_event.customer_id,
    )


def prepare_event(session: Session, run_id: str, risk_event: RiskEvent, sim_customer: SimCustomer, params: WorldParams, rng: random.Random, now: datetime):
    """Returns a FeatureInputs to batch-score, or None if the event was already fully resolved here (never started, 9.4)."""
    append_entry(
        session, run_id=run_id, stage=AuditStage.DETECT, actor=AuditActor.SIMULATOR, sim_time=now, risk_event_id=risk_event.id, customer_id=risk_event.customer_id,
        summary=f"Detected {risk_event.kind.value}, value at risk Rs{risk_event.value_at_risk_paise / 100:,.2f}",
    )
    diagnose(session, risk_event)

    if risk_event.value_at_risk_paise < settings.min_value_at_risk_paise:
        # 9.4: "value_at_risk < Rs40 -> never start" — no ML/EV spend, but
        # still a real, auditable Decision row (reason_code=edge_too_thin —
        # 4.3's own wording for "the edge is too thin to justify contact",
        # which is exactly what "the message costs more than the margin"
        # means here, just decided before running the EV engine rather than
        # after). Every risk_event that reaches a terminal outcome has both a
        # decision and an outcome (app/schemas/cases.py's CaseListItem
        # requires both, matching the frontend's fixture-derived contract)
        # — this is never a placeholder, it's what actually happened.
        decision = Decision(
            risk_event_id=risk_event.id,
            chosen_action=Action.HOLD,
            chosen_params={},
            reason_code=ReasonCode.EDGE_TOO_THIN,
            p_baseline=Decimal(0),
            best_ev_paise=0,
            best_ev_ci_low_paise=0,
            best_ev_ci_high_paise=0,
            hold_margin_protected_paise=0,
            decided_by=DecidedBy.ENGINE,
            latency_ms=0,
            decided_at_sim=now,
        )
        session.add(decision)
        risk_event.status = RiskEventStatus.DECIDED
        session.add(risk_event)
        session.commit()

        opted_out, cf = resolve_and_inject(session, sim_customer, risk_event, Action.HOLD, now, params, rng, 0)
        outcome = attribute_outcome(session, risk_event, now, total_cost_paise=0, counterfactual_recovered_paise=cf, opted_out=opted_out)
        _log_outcome(session, run_id, risk_event, outcome, now)
        return None

    return build_feature_inputs(session, risk_event, sim_customer.row, now)


def decide_and_act(session: Session, run_id: str, risk_event: RiskEvent, sim_customer: SimCustomer, params: WorldParams, rng: random.Random, inputs, scores, now: datetime, policies: list[Policy]) -> None:
    decision = decide(session, risk_event, sim_customer.row, scores, now, inferred_salary_day=sim_customer.row.inferred_salary_day, policies=policies)
    append_entry(
        session, run_id=run_id, stage=AuditStage.DECIDE, actor=AuditActor.ENGINE, sim_time=now, risk_event_id=risk_event.id, customer_id=risk_event.customer_id,
        summary=f"Decided {decision.chosen_action.value} ({decision.reason_code.value})",
        detail={"best_ev_paise": decision.best_ev_paise, "ci_low_paise": decision.best_ev_ci_low_paise, "ci_high_paise": decision.best_ev_ci_high_paise},
    )
    if decision.blocked_actions:
        blocked_summary = ", ".join(f"{b['action']} ({b['policy_name']})" for b in decision.blocked_actions)
        append_entry(
            session, run_id=run_id, stage=AuditStage.POLICY, actor=AuditActor.ENGINE, sim_time=now, risk_event_id=risk_event.id, customer_id=risk_event.customer_id,
            summary=f"Guardrail blocked: {blocked_summary}",
            detail={"blocked_actions": decision.blocked_actions},
        )

    action_record = act(session, decision, risk_event, sim_customer.row, now)
    risk_event.status = RiskEventStatus.ACTING if action_record else RiskEventStatus.DECIDED
    session.add(risk_event)
    session.commit()
    if action_record is not None:
        append_entry(
            session, run_id=run_id, stage=AuditStage.ACT, actor=AuditActor.ENGINE, sim_time=now, risk_event_id=risk_event.id, customer_id=risk_event.customer_id,
            summary=f"Dispatched {action_record.type.value}, cost Rs{action_record.cost_paise / 100:,.2f}",
        )

    if decision.chosen_action == Action.HOLD:
        opted_out, cf = resolve_and_inject(session, sim_customer, risk_event, Action.HOLD, now, params, rng, inputs.messages_received_7d)
        outcome = attribute_outcome(session, risk_event, now, total_cost_paise=0, counterfactual_recovered_paise=cf, opted_out=opted_out)
        _log_outcome(session, run_id, risk_event, outcome, now)
    elif decision.chosen_action == Action.RETRY_SCHEDULED:
        scheduled_for = datetime.fromisoformat(decision.chosen_params["scheduled_for_sim"])
        opted_out, cf = resolve_and_inject(session, sim_customer, risk_event, Action.RETRY_SCHEDULED, scheduled_for, params, rng, inputs.messages_received_7d, original_event_time=now)
        session.refresh(action_record)
        if action_record.status == ActionStatus.SCHEDULED:  # wasn't cancelled by the self-recovery race above
            action_record.status, action_record.executed_at_sim = ActionStatus.EXECUTED, scheduled_for
            session.add(action_record)
            session.commit()
        outcome = attribute_outcome(session, risk_event, scheduled_for, total_cost_paise=action_record.cost_paise, counterfactual_recovered_paise=cf, opted_out=opted_out)
        _log_outcome(session, run_id, risk_event, outcome, scheduled_for)
    else:
        opted_out, cf = resolve_and_inject(session, sim_customer, risk_event, decision.chosen_action, now, params, rng, inputs.messages_received_7d)
        outcome = attribute_outcome(session, risk_event, now, total_cost_paise=action_record.cost_paise, counterfactual_recovered_paise=cf, opted_out=opted_out)
        _log_outcome(session, run_id, risk_event, outcome, now)


# --- the "holdout" arm: pure implicit HOLD, no agent at all --------------------------------------


def run_holdout_arm(session: Session, run_id: str, risk_event: RiskEvent, sim_customer: SimCustomer, params: WorldParams, rng: random.Random, now: datetime) -> None:
    diagnose(session, risk_event)

    # No agent runs in the holdout arm, by definition (3.2) — but every
    # terminal risk_event still gets a real Decision row (app/schemas/cases.py's
    # CaseListItem always requires one): "HOLD, no_action_beats_hold" is a
    # structural fact about holdout, not a guess about what would have
    # happened had an agent been watching.
    decision = Decision(
        risk_event_id=risk_event.id, chosen_action=Action.HOLD, chosen_params={}, reason_code=ReasonCode.NO_ACTION_BEATS_HOLD,
        p_baseline=Decimal(0), best_ev_paise=0, best_ev_ci_low_paise=0, best_ev_ci_high_paise=0, hold_margin_protected_paise=0,
        decided_by=DecidedBy.ENGINE, latency_ms=0, decided_at_sim=now,
    )
    session.add(decision)
    risk_event.status = RiskEventStatus.DECIDED
    session.add(risk_event)
    session.commit()

    outcome_draw = resolve_paired_outcome(risk_event.cause_code, sim_customer, Action.HOLD, now, params, rng)
    if outcome_draw.chosen_recovered:
        _mark_paid(session, risk_event, sim_customer, now + timedelta(hours=outcome_draw.chosen_delay_hours), rng)
    outcome = attribute_outcome(session, risk_event, now, total_cost_paise=0, counterfactual_recovered_paise=risk_event.value_at_risk_paise if outcome_draw.hold_recovered else 0)
    _log_outcome(session, run_id, risk_event, outcome, now)


# --- the "baseline" arm: a real, simple, non-restrained fixed policy -----------------------------
# Still guardrail-compliant (a real naive system still wouldn't text someone
# who opted out) but skips the EV/restraint reasoning entirely — "the system
# currently in place tries the obvious thing every time." This is what makes
# 8.4's "we recover less, and make more" comparison a genuine measurement
# rather than an invented number: baseline brute-forces contact on every
# event (higher direct/annoyance cost) while the agent holds when the
# arithmetic says to.

_BASELINE_ACTION_BY_KIND = {RiskEventKind.FAILED_RENEWAL: Action.RETRY_NOW, RiskEventKind.ABANDONED_CHECKOUT: Action.NUDGE_FREE}


def run_baseline_arm(session: Session, run_id: str, risk_event: RiskEvent, sim_customer: SimCustomer, params: WorldParams, rng: random.Random, now: datetime, policies: list[Policy]) -> None:
    diagnose(session, risk_event)
    action = _BASELINE_ACTION_BY_KIND[risk_event.kind]

    extra_context = contact_counts(session, risk_event, sim_customer.row, now)
    filter_result = policy_filter([action], event=risk_event, customer=sim_customer.row, sim_time=now, policies=policies, extra_context=extra_context)
    if action not in filter_result.allowed:
        action = Action.HOLD

    chosen_params = {}
    if action == Action.NUDGE_FREE:
        chosen_params = {"channel": (Channel.WHATSAPP if sim_customer.row.whatsapp_opted_in else Channel.EMAIL).value, "language": sim_customer.row.preferred_language.value}

    decision = Decision(
        risk_event_id=risk_event.id,
        chosen_action=action,
        chosen_params=chosen_params,
        reason_code=ReasonCode.POLICY_BLOCKED if action == Action.HOLD else ReasonCode.POSITIVE_EV,
        p_baseline=Decimal(0),
        best_ev_paise=0,
        best_ev_ci_low_paise=0,
        best_ev_ci_high_paise=0,
        decided_by=DecidedBy.ENGINE,
        latency_ms=0,
        decided_at_sim=now,
    )
    session.add(decision)
    session.commit()
    session.refresh(decision)

    action_record = act(session, decision, risk_event, sim_customer.row, now) if action != Action.HOLD else None
    risk_event.status = RiskEventStatus.ACTING if action_record else RiskEventStatus.DECIDED
    session.add(risk_event)
    session.commit()

    opted_out, cf = resolve_and_inject(session, sim_customer, risk_event, action, now, params, rng, 0)
    total_cost = action_record.cost_paise if action_record else 0
    outcome = attribute_outcome(session, risk_event, now, total_cost_paise=total_cost, counterfactual_recovered_paise=cf, opted_out=opted_out)
    _log_outcome(session, run_id, risk_event, outcome, now)


_OPEN_STATUSES = [RiskEventStatus.DETECTED, RiskEventStatus.DIAGNOSED, RiskEventStatus.SCORED, RiskEventStatus.DECIDED, RiskEventStatus.ACTING]


def _sweep_expirations(session: Session, run_id: str, now: datetime) -> None:
    """
    Every other stopping rule (resolved, opted-out, lost-after-n-actions)
    closes its event immediately at decision/action time — this sweep exists
    only to catch the purely time-based one (9.4: 14 sim-days). Filtering by
    the expiry cutoff in SQL, rather than re-fetching every still-open event
    every day, keeps this O(events that just crossed the threshold today),
    not O(the whole accumulated open backlog) — the latter turned a 30-day
    run into an O(days x open_events) blowup.
    """
    expiry_cutoff = now - timedelta(days=settings.event_expiry_sim_days)
    newly_expired = session.exec(select(RiskEvent).where(RiskEvent.run_id == run_id, RiskEvent.status.in_(_OPEN_STATUSES), RiskEvent.detected_at_sim <= expiry_cutoff)).all()
    for event in newly_expired:
        attribute_outcome(session, event, now, total_cost_paise=0, counterfactual_recovered_paise=0)


# --- orchestration -------------------------------------------------------------------------------


def create_run(session: Session, world_config: WorldConfig, arms: list[str], population_size: int, sim_days: int, seed: int) -> Run:
    """Fast, synchronous — just the DB row. `execute_run` does the actual work, on a background thread for the API (stage 7)."""
    run = Run(world_config_id=world_config.id, arms=arms, population_size=population_size, sim_days=sim_days, status=RunStatus.PENDING, seed=seed, started_at=SIM_START)
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def _wait_while_paused(run_id: str) -> bool:
    """Polls `runs.status` — the DB is the source of truth for pause/resume, set by the API's pause/resume endpoints. Returns False if the run was deleted out from under it (stop immediately)."""
    while True:
        with Session(engine) as session:
            run = session.get(Run, run_id)
            if run is None:
                return False
            if run.status != RunStatus.PAUSED:
                return True
        time.sleep(_PAUSE_POLL_SECONDS)


def execute_run(run_id: str) -> None:
    """The heavy loop. Opens its own Session — safe to call from a background thread (app/db.py enables SQLite multi-thread access for exactly this)."""
    with Session(engine) as session:
        run = session.get(Run, run_id)
        world_config = session.get(WorldConfig, run.world_config_id)
        params = WorldParams(**world_config.params)
        sim_days, seed, arms = run.sim_days, run.seed, [Arm(a) for a in run.arms]

        run.status = RunStatus.RUNNING
        session.add(run)
        session.commit()

        py_rng = random.Random(seed)
        create_all()
        policies = seed_policies(session)

        population = generate_population(params.population_size, SIM_START, params, py_rng)
        customer_by_id: dict[str, SimCustomer] = {}
        for sim_customer in population:
            session.add(sim_customer.row)
            if sim_customer.subscription is not None:
                session.add(sim_customer.subscription)
        session.commit()
        for sim_customer in population:
            customer_by_id[sim_customer.row.id] = sim_customer

        bundle = load_default_bundle()
        events_processed = 0
        set_progress(run_id, sim_day=0, total_days=sim_days, events_processed=0, events_total=0)

        for day in range(sim_days):
            if not _wait_while_paused(run_id):
                clear_progress(run_id)
                return  # run was deleted mid-flight

            day_start = SIM_START + timedelta(days=day)

            for sim_customer in population:
                if py_rng.random() < CHECKOUT_DAILY_PROBABILITY:
                    event_time = day_start + timedelta(hours=py_rng.uniform(6, 22))
                    checkout, attempts, _ = generate_checkout_event(sim_customer, event_time, params, py_rng, resolve_immediately=False)
                    session.add(checkout)
                    session.add_all(attempts)

                if sim_customer.has_subscription and day_start.day == sim_customer.subscription.billing_day:
                    event_time = day_start + timedelta(hours=py_rng.uniform(0, 6))
                    attempts, _ = generate_renewal_event(sim_customer, event_time, params, py_rng, resolve_immediately=False)
                    session.add_all(attempts)
            session.commit()

            new_events = detect_new_risk_events(session, run_id, day_start + timedelta(hours=23))
            for event in new_events:
                event.arm = py_rng.choice(arms)
                session.add(event)
            session.commit()

            agent_events, agent_inputs = [], []
            for risk_event in new_events:
                sim_customer = customer_by_id[risk_event.customer_id]
                if risk_event.arm == Arm.HOLDOUT:
                    run_holdout_arm(session, run_id, risk_event, sim_customer, params, py_rng, risk_event.detected_at_sim)
                elif risk_event.arm == Arm.BASELINE:
                    run_baseline_arm(session, run_id, risk_event, sim_customer, params, py_rng, risk_event.detected_at_sim, policies)
                else:
                    inputs = prepare_event(session, run_id, risk_event, sim_customer, params, py_rng, risk_event.detected_at_sim)
                    if inputs is not None:  # None => already resolved in prepare_event (never-start rule, 9.4)
                        agent_events.append(risk_event)
                        agent_inputs.append(inputs)

            if agent_inputs:
                agent_scores = score_events_batch(bundle, agent_inputs)
                for risk_event, inputs, scores in zip(agent_events, agent_inputs, agent_scores, strict=True):
                    sim_customer = customer_by_id[risk_event.customer_id]
                    decide_and_act(session, run_id, risk_event, sim_customer, params, py_rng, inputs, scores, risk_event.detected_at_sim, policies)

            _sweep_expirations(session, run_id, day_start + timedelta(hours=23, minutes=59))

            events_processed += len(new_events)
            events_total_estimate = round(events_processed / (day + 1) * sim_days)
            set_progress(run_id, sim_day=day + 1, total_days=sim_days, events_processed=events_processed, events_total=events_total_estimate)

        run.status, run.completed_at = RunStatus.COMPLETED, day_start
        session.add(run)
        session.commit()
        set_progress(run_id, sim_day=sim_days, total_days=sim_days, events_processed=events_processed, events_total=events_processed)

        print_summary(session, run_id)
        chain = verify_chain(session, run_id)
        print(f"Audit chain: {'INTACT' if chain.intact else f'BROKEN at {chain.broken_entry_id}'} ({chain.entries_checked} entries checked, 9.6)")


def run_live_loop(params: WorldParams, sim_days: int, seed: int) -> str:
    """CLI convenience wrapper (stage 5's original entry point) — creates its own WorldConfig + Run, then runs synchronously in the calling thread."""
    create_all()
    with Session(engine) as session:
        world_config = WorldConfig(name=WorldConfigName.DEFAULT, params=dict(asdict(params).items()))
        session.add(world_config)
        session.commit()
        session.refresh(world_config)

        run = create_run(session, world_config, [Arm.AGENT.value], params.population_size, sim_days, seed)
        run_id = run.id
        print(f"Seeded run {run_id}; generating {params.population_size} customers (seed={seed})...")

    print(f"Running the live agent loop across {sim_days} sim-days...")
    execute_run(run_id)
    return run_id


def print_summary(session: Session, run_id: str) -> None:
    decisions = session.exec(select(Decision).join(RiskEvent, Decision.risk_event_id == RiskEvent.id).where(RiskEvent.run_id == run_id)).all()
    outcomes = session.exec(select(Outcome).join(RiskEvent, Outcome.risk_event_id == RiskEvent.id).where(RiskEvent.run_id == run_id)).all()

    print("\n" + "=" * 72)
    print(f"HOLD AGENT LOOP — run_id={run_id}")
    print("=" * 72)

    print(f"\nRisk events processed: {len(decisions)}  |  resolved: {len(outcomes)}")

    print("\nDecisions by reason_code:")
    for reason in ReasonCode:
        count = sum(1 for d in decisions if d.reason_code == reason)
        if count:
            print(f"  {reason.value:<22} {count:>5}")

    print("\nActions chosen:")
    for action in Action:
        count = sum(1 for d in decisions if d.chosen_action == action)
        if count:
            print(f"  {action.value:<18} {count:>5}")

    cancelled = session.exec(
        select(ActionRecord).join(RiskEvent, ActionRecord.risk_event_id == RiskEvent.id).where(RiskEvent.run_id == run_id, ActionRecord.status == ActionStatus.CANCELLED)
    ).all()
    print(f"\nScheduled actions cancelled (customer self-recovered first, 9.4): {len(cancelled)}")

    triggered_policies = session.exec(select(Policy).where(Policy.trigger_count > 0)).all()
    if triggered_policies:
        print("\nGuardrails triggered (9.3, trigger_count):")
        for policy in sorted(triggered_policies, key=lambda p: -p.trigger_count):
            print(f"  {policy.name:<42} {policy.trigger_count:>5}")

    if outcomes:
        total_net_profit = sum(o.net_profit_paise for o in outcomes)
        total_incremental = sum(o.incremental_profit_paise for o in outcomes)
        total_recovered = sum(o.recovered_paise for o in outcomes)
        resolved_count = sum(1 for o in outcomes if o.resolved)
        print(f"\nTotal recovered: Rs{total_recovered / 100:,.2f}  |  resolved {resolved_count}/{len(outcomes)} ({resolved_count / len(outcomes):.1%})")
        print(f"Total net profit: Rs{total_net_profit / 100:,.2f}")
        print(f"Total incremental profit vs the HOLD counterfactual (the scoreboard number, 5.4): Rs{total_incremental / 100:,.2f}")

    print("=" * 72 + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the HOLD live agent loop standalone and print a summary.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--population", type=int, default=2000)
    parser.add_argument("--arms", type=str, default="agent", help="comma-separated: agent,baseline,holdout")
    args = parser.parse_args()

    params = WorldParams(seed=args.seed, population_size=args.population, sim_days=args.days)
    create_all()
    with Session(engine) as session:
        world_config = WorldConfig(name=WorldConfigName.DEFAULT, params=dict(asdict(params).items()))
        session.add(world_config)
        session.commit()
        session.refresh(world_config)

        arms = [a.strip() for a in args.arms.split(",") if a.strip()]
        run = create_run(session, world_config, arms, params.population_size, args.days, args.seed)
        run_id = run.id

    print(f"Seeded run {run_id} (arms={arms}); generating {params.population_size} customers (seed={args.seed})...")
    print(f"Running the live agent loop across {args.days} sim-days...")
    execute_run(run_id)


if __name__ == "__main__":
    main()
