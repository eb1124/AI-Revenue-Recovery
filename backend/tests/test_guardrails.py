"""
The six guardrail tests (section 9.5) — written before the engine (stage-6
brief: "write them before the engine"). `app/agent/policy.py` (the guardrail
engine) and `app/audit.py` (the hash-chained writer) do not exist yet; this
file is expected to fail collection until stage 6 builds them. Pinning the
contract here first is the point: stage 6 is written to make these pass, not
the other way around.

Contract these tests require from stage 6:

    app/agent/policy.py
        @dataclass(frozen=True)
        class PolicyBlock:
            action: Action
            policy_id: str
            policy_name: str

        @dataclass(frozen=True)
        class PolicyFilterResult:
            allowed: list[Action]
            blocked: list[PolicyBlock]

        def policy_filter(
            candidate_actions: list[Action], *, event: RiskEvent, customer: Customer,
            sim_time: datetime, policies: list[Policy],
        ) -> PolicyFilterResult:
            "Evaluate each enabled hard_block policy's `rule` (section 9.2's
            any/all/{field,op,value} predicate grammar) against a context built
            from event/customer/sim_time. An action is blocked if it appears in
            a matching policy's `applies_to`. Never mutates `policies`."

        def cancel_scheduled_actions(
            session: Session, *, risk_event_id: str, reason: str,
        ) -> list[ActionRecord]:
            "Section 9.4: 'Event resolved -> stop, cancel all scheduled actions.'
            Sets status=CANCELLED and cancel_reason on every ActionRecord for
            this risk_event still in status=SCHEDULED. Leaves EXECUTED/already
            CANCELLED/BLOCKED actions untouched. Returns the rows it changed."

    app/audit.py
        def append_entry(
            session: Session, *, run_id: str, stage: AuditStage, summary: str,
            actor: AuditActor, sim_time: datetime, detail: dict | None = None,
            risk_event_id: str | None = None, customer_id: str | None = None,
        ) -> AuditEntry:
            "Appends one hash-chained entry: hash = sha256(prev_hash + canonical
            payload). prev_hash is the previous entry's hash for this run_id, or
            '0' * 64 for the first entry in a run."

        @dataclass(frozen=True)
        class ChainVerification:
            intact: bool
            broken_entry_id: str | None

        def verify_chain(session: Session, run_id: str) -> ChainVerification:
            "Recomputes every entry's hash from (prev_hash + payload) in
            sim_time order and compares to the stored hash. Returns the id of
            the first entry whose recomputed hash does not match."
"""

from datetime import UTC, datetime

from conftest import make_action, make_customer, make_decision, make_risk_event, make_run

from app.agent.policy import cancel_scheduled_actions, policy_filter
from app.audit import append_entry, verify_chain
from app.models.enums import Action, ActionStatus, AuditActor, AuditStage, CauseCode, FarmingTier, PolicyKind
from app.models.policies import Policy

# --- the four hard_block policies these tests exercise, built exactly per
# section 9.2's rule grammar and section 9.3's table --------------------------


def _quiet_hours_policy() -> Policy:
    return Policy(
        name="Quiet hours 20:00-09:00 IST",
        kind=PolicyKind.HARD_BLOCK,
        applies_to=[Action.NUDGE_FREE.value, Action.NUDGE_INCENTIVE.value],
        rule={"any": [{"field": "sim_time.hour", "op": "gte", "value": 20}, {"field": "sim_time.hour", "op": "lt", "value": 9}]},
        enabled=True,
    )


def _hard_optout_policy() -> Policy:
    return Policy(
        name="Hard opt-out is permanent",
        kind=PolicyKind.HARD_BLOCK,
        applies_to=[
            Action.RETRY_NOW.value,
            Action.RETRY_SCHEDULED.value,
            Action.NUDGE_FREE.value,
            Action.NUDGE_INCENTIVE.value,
            Action.ESCALATE_HUMAN.value,
        ],
        rule={"field": "customer.hard_optout", "op": "eq", "value": True},
        enabled=True,
    )


def _no_retry_dead_mandate_policy() -> Policy:
    return Policy(
        name="No retries on expired_card / mandate_revoked",
        kind=PolicyKind.HARD_BLOCK,
        applies_to=[Action.RETRY_NOW.value, Action.RETRY_SCHEDULED.value],
        rule={"field": "event.cause_code", "op": "in", "value": [CauseCode.EXPIRED_CARD.value, CauseCode.MANDATE_REVOKED.value]},
        enabled=True,
    )


def _no_incentive_flagged_farmer_policy() -> Policy:
    return Policy(
        name="No incentives to flagged farmers",
        kind=PolicyKind.HARD_BLOCK,
        applies_to=[Action.NUDGE_INCENTIVE.value],
        rule={"field": "customer.farming_tier", "op": "eq", "value": FarmingTier.FLAGGED.value},
        enabled=True,
    )


def _blocked_actions(result) -> set[Action]:
    return {b.action for b in result.blocked}


# --- 1. Quiet hours -----------------------------------------------------------


def test_quiet_hours_blocks_message_at_21_00(session):
    customer = make_customer(session)
    run = make_run(session)
    event = make_risk_event(session, customer, run)
    sim_time = datetime(2026, 8, 15, 21, 0, tzinfo=UTC)

    result = policy_filter(
        [Action.NUDGE_FREE, Action.NUDGE_INCENTIVE, Action.RETRY_NOW],
        event=event,
        customer=customer,
        sim_time=sim_time,
        policies=[_quiet_hours_policy()],
    )

    assert Action.NUDGE_FREE not in result.allowed
    assert Action.NUDGE_INCENTIVE not in result.allowed
    assert Action.RETRY_NOW in result.allowed  # not a messaging action — quiet hours doesn't touch it
    assert _blocked_actions(result) == {Action.NUDGE_FREE, Action.NUDGE_INCENTIVE}
    assert all(b.policy_name == "Quiet hours 20:00-09:00 IST" for b in result.blocked)


# --- 2. Hard opt-out ------------------------------------------------------------


def test_hard_optout_blocks_every_action_type(session):
    customer = make_customer(session, hard_optout=True)
    run = make_run(session)
    event = make_risk_event(session, customer, run)
    sim_time = datetime(2026, 8, 15, 12, 0, tzinfo=UTC)

    all_actions = list(Action)
    result = policy_filter(
        all_actions,
        event=event,
        customer=customer,
        sim_time=sim_time,
        policies=[_hard_optout_policy()],
    )

    non_hold = [a for a in all_actions if a != Action.HOLD]
    assert all(a not in result.allowed for a in non_hold)
    assert _blocked_actions(result) == set(non_hold)
    assert Action.HOLD in result.allowed  # doing nothing is never "contact"


# --- 3. Flagged farmers -----------------------------------------------------------


def test_flagged_farmer_cannot_receive_incentive(session):
    customer = make_customer(session, farming_tier=FarmingTier.FLAGGED)
    run = make_run(session)
    event = make_risk_event(session, customer, run)
    sim_time = datetime(2026, 8, 15, 12, 0, tzinfo=UTC)

    result = policy_filter(
        [Action.NUDGE_FREE, Action.NUDGE_INCENTIVE],
        event=event,
        customer=customer,
        sim_time=sim_time,
        policies=[_no_incentive_flagged_farmer_policy()],
    )

    assert Action.NUDGE_INCENTIVE not in result.allowed
    assert Action.NUDGE_FREE in result.allowed  # 4.5: "NUDGE_FREE still allowed" for flagged farmers


# --- 4. Expired card never retries -----------------------------------------------


def test_expired_card_never_produces_a_retry(session):
    customer = make_customer(session)
    run = make_run(session)
    event = make_risk_event(session, customer, run, cause_code=CauseCode.EXPIRED_CARD)
    sim_time = datetime(2026, 8, 15, 12, 0, tzinfo=UTC)

    result = policy_filter(
        [Action.RETRY_NOW, Action.RETRY_SCHEDULED, Action.NUDGE_FREE],
        event=event,
        customer=customer,
        sim_time=sim_time,
        policies=[_no_retry_dead_mandate_policy()],
    )

    assert Action.RETRY_NOW not in result.allowed
    assert Action.RETRY_SCHEDULED not in result.allowed
    assert Action.NUDGE_FREE in result.allowed  # 6.3: update-link nudge is still the right move


# --- 5. Self-recovery cancels open actions ----------------------------------------


def test_scheduled_action_cancels_on_self_recovery(session):
    customer = make_customer(session)
    run = make_run(session)
    event = make_risk_event(session, customer, run)
    decision = make_decision(session, event)

    scheduled = make_action(session, decision, event, status=ActionStatus.SCHEDULED)
    already_sent = make_action(session, decision, event, type=Action.NUDGE_FREE, status=ActionStatus.EXECUTED)

    changed = cancel_scheduled_actions(session, risk_event_id=event.id, reason="customer self-recovered before the scheduled action")

    session.refresh(scheduled)
    session.refresh(already_sent)

    assert scheduled.status == ActionStatus.CANCELLED
    assert scheduled.cancel_reason == "customer self-recovered before the scheduled action"
    assert scheduled.id in {a.id for a in changed}

    # An already-executed action has nothing to cancel — must be left alone.
    assert already_sent.status == ActionStatus.EXECUTED
    assert already_sent.cancel_reason is None
    assert already_sent.id not in {a.id for a in changed}


# --- 6. Audit hash chain tamper-evidence -------------------------------------------

SIM_TIME_1 = datetime(2026, 8, 15, 9, 0, tzinfo=UTC)
SIM_TIME_2 = datetime(2026, 8, 15, 9, 1, tzinfo=UTC)
SIM_TIME_3 = datetime(2026, 8, 15, 10, 0, tzinfo=UTC)


def test_audit_hash_chain_detects_tampering(session):
    run = make_run(session)

    e1 = append_entry(session, run_id=run.id, stage=AuditStage.DETECT, summary="Risk event detected", actor=AuditActor.SIMULATOR, sim_time=SIM_TIME_1)
    e2 = append_entry(session, run_id=run.id, stage=AuditStage.DECIDE, summary="HOLD chosen", actor=AuditActor.ENGINE, sim_time=SIM_TIME_2)
    e3 = append_entry(session, run_id=run.id, stage=AuditStage.VERIFY, summary="Resolved by self-recovery", actor=AuditActor.ENGINE, sim_time=SIM_TIME_3)

    # The chain links: each entry's prev_hash is the previous entry's hash.
    assert e2.prev_hash == e1.hash
    assert e3.prev_hash == e2.hash

    result = verify_chain(session, run_id=run.id)
    assert result.intact is True
    assert result.broken_entry_id is None

    # Simulate a manual `UPDATE audit_entries SET summary = ...` in psql.
    e2.summary = "HOLD chosen (tampered)"
    session.add(e2)
    session.commit()

    tampered_result = verify_chain(session, run_id=run.id)
    assert tampered_result.intact is False
    assert tampered_result.broken_entry_id == e2.id
