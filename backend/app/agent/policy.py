"""
The guardrail engine (section 9.2-9.3) — structured JSON predicates
evaluated BEFORE the EV comparison, removing actions from the candidate
set. "They never overrule a decision after the fact" (9.2) — that ordering
is enforced by decide.py calling `policy_filter` before `max(candidates,
key=ev)`, not by anything in this file.

`policy_filter`'s signature and return shape were pinned by
`tests/test_guardrails.py` back in stage 3, before this file existed —
those six tests are what "done" means for this module. Everything here
satisfies that contract; nothing here changes it.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.config import settings
from app.models.actions import ActionRecord, Message
from app.models.customers import Customer
from app.models.enums import Action, ActionStatus, PolicyAuthoredBy, PolicyKind, RiskEventKind
from app.models.policies import Policy
from app.models.risk_events import RiskEvent


@dataclass(frozen=True)
class PolicyBlock:
    action: Action
    policy_id: str
    policy_name: str


@dataclass(frozen=True)
class PolicyFilterResult:
    allowed: list[Action]
    blocked: list[PolicyBlock]


# --- the rule grammar (9.2): {"any"|"all": [...]} combinators over {"field", "op", "value"} leaves ---


def _get_field(context: dict, path: str):
    obj = context
    for part in path.split("."):
        obj = obj[part]
    return obj


def _eval_leaf(leaf: dict, context: dict) -> bool:
    value = _get_field(context, leaf["field"])
    op, target = leaf["op"], leaf["value"]
    if op == "eq":
        return value == target
    if op == "ne":
        return value != target
    if op == "gte":
        return value >= target
    if op == "gt":
        return value > target
    if op == "lte":
        return value <= target
    if op == "lt":
        return value < target
    if op == "in":
        return value in target
    raise ValueError(f"unknown policy rule op: {op!r}")


def _eval_rule(rule: dict, context: dict) -> bool:
    if "any" in rule:
        return any(_eval_rule(r, context) for r in rule["any"])
    if "all" in rule:
        return all(_eval_rule(r, context) for r in rule["all"])
    return _eval_leaf(rule, context)


def _build_context(event: RiskEvent, customer: Customer, sim_time: datetime, extra_context: dict | None) -> dict:
    return {
        "sim_time": {"hour": sim_time.hour},
        "customer": {
            "hard_optout": customer.hard_optout,
            "farming_tier": customer.farming_tier.value,
            # Derived, not a literal in any rule — a 72h-cooldown policy
            # needs to compare two per-customer timestamps to each other,
            # which the field/op/value grammar (a field vs. a fixed literal)
            # can't express directly. Computing the boolean here keeps the
            # stored rule (9.2) simple; see DEFAULT_POLICIES' cooldown entry.
            "in_cooldown": customer.contactable_after is not None and sim_time < customer.contactable_after,
        },
        "event": {
            "cause_code": event.cause_code.value if event.cause_code else None,
            "value_at_risk_paise": event.value_at_risk_paise,
        },
        # defaultdict, not a plain dict: a caller that doesn't compute one of
        # the four dynamic counts (contact_counts, below) — e.g. a
        # what-if policy simulation that doesn't want the DB queries —
        # safely reads as "0 so far" rather than KeyError-ing. A missing
        # *static* field (customer/event/sim_time, always fully populated
        # above) still raises, which is what you want if a rule has a typo.
        "counts": defaultdict(int, extra_context or {}),
    }


def policy_filter(
    candidate_actions: list[Action],
    *,
    event: RiskEvent,
    customer: Customer,
    sim_time: datetime,
    policies: list[Policy],
    extra_context: dict | None = None,
) -> PolicyFilterResult:
    """
    An action is blocked if some enabled policy's `rule` matches the context
    AND that action appears in the policy's `applies_to`. `hard_block`,
    `cap`, and `require_approval` policies are treated identically here —
    the distinction that matters to this function is "does this action
    survive," not the label on the row. `extra_context` (optional) carries
    dynamic counts (contacts this event, messages sent recently, mandate
    retries) that `policy_filter` itself never queries for — see
    `contact_counts` below, which decide.py calls to build it. This keeps
    `policy_filter` a pure function over already-known data, exactly as
    stage 3's tests exercise it.
    """
    context = _build_context(event, customer, sim_time, extra_context)

    blocked: list[PolicyBlock] = []
    allowed: list[Action] = []
    for action in candidate_actions:
        block = None
        for policy in policies:
            if not policy.enabled or action.value not in policy.applies_to:
                continue
            if _eval_rule(policy.rule, context):
                block = PolicyBlock(action=action, policy_id=policy.id, policy_name=policy.name)
                break
        if block:
            blocked.append(block)
        else:
            allowed.append(action)
    return PolicyFilterResult(allowed=allowed, blocked=blocked)


def cancel_scheduled_actions(session: Session, risk_event_id: str, reason: str) -> list[ActionRecord]:
    """9.4: "Event resolved -> stop, cancel all scheduled actions." / the explicit cancel-on-self-recovery path."""
    rows = session.exec(select(ActionRecord).where(ActionRecord.risk_event_id == risk_event_id, ActionRecord.status == ActionStatus.SCHEDULED)).all()
    for row in rows:
        row.status = ActionStatus.CANCELLED
        row.cancel_reason = reason
        session.add(row)
    if rows:
        session.commit()
        for row in rows:
            session.refresh(row)
    return rows


def contact_counts(session: Session, risk_event: RiskEvent, customer: Customer, now: datetime) -> dict[str, int]:
    """The dynamic counts caps #3/#4/#5/#7 (9.3) need — queried here, not inside `policy_filter` itself."""
    contacts_this_event = len(
        session.exec(select(ActionRecord).where(ActionRecord.risk_event_id == risk_event.id, ActionRecord.status.in_([ActionStatus.EXECUTED, ActionStatus.SCHEDULED]))).all()
    )

    since_24h, since_7d = now - timedelta(hours=24), now - timedelta(days=7)
    sent_times = session.exec(
        select(Message.sent_at_sim)
        .join(ActionRecord, Message.action_id == ActionRecord.id)
        .join(RiskEvent, ActionRecord.risk_event_id == RiskEvent.id)
        .where(RiskEvent.customer_id == customer.id, Message.sent_at_sim.is_not(None))
    ).all()
    messages_24h = sum(1 for t in sent_times if t >= since_24h)
    messages_7d = sum(1 for t in sent_times if t >= since_7d)

    mandate_retry_count = 0
    if risk_event.kind == RiskEventKind.FAILED_RENEWAL:
        mandate_retry_count = len(
            session.exec(
                select(ActionRecord)
                .join(RiskEvent, ActionRecord.risk_event_id == RiskEvent.id)
                .where(RiskEvent.source_id == risk_event.source_id, ActionRecord.type.in_([Action.RETRY_NOW, Action.RETRY_SCHEDULED]))
            ).all()
        )

    return {"contacts_this_event": contacts_this_event, "messages_24h": messages_24h, "messages_7d": messages_7d, "mandate_retry_count": mandate_retry_count}


# --- the 11 shipped policies (9.3) ------------------------------------------------------------

_CONTACT_ACTIONS = [a.value for a in (Action.RETRY_NOW, Action.RETRY_SCHEDULED, Action.NUDGE_FREE, Action.NUDGE_INCENTIVE, Action.ESCALATE_HUMAN)]
_MESSAGE_ACTIONS = [Action.NUDGE_FREE.value, Action.NUDGE_INCENTIVE.value]
_RETRY_ACTIONS = [Action.RETRY_NOW.value, Action.RETRY_SCHEDULED.value]
_AUTO_EXECUTING_ACTIONS = [Action.RETRY_NOW.value, Action.RETRY_SCHEDULED.value, Action.NUDGE_FREE.value, Action.NUDGE_INCENTIVE.value]

DEFAULT_POLICIES: list[dict] = [
    {
        "name": "Quiet hours 20:00-09:00 IST",
        "kind": PolicyKind.HARD_BLOCK,
        "applies_to": _MESSAGE_ACTIONS,
        "rule": {"any": [{"field": "sim_time.hour", "op": "gte", "value": 20}, {"field": "sim_time.hour", "op": "lt", "value": 9}]},
    },
    {
        "name": "Hard opt-out is permanent",
        "kind": PolicyKind.HARD_BLOCK,
        "applies_to": _CONTACT_ACTIONS,
        "rule": {"field": "customer.hard_optout", "op": "eq", "value": True},
    },
    {
        "name": "Maximum 3 contacts per event",
        "kind": PolicyKind.CAP,
        "applies_to": _CONTACT_ACTIONS,
        "rule": {"field": "counts.contacts_this_event", "op": "gte", "value": settings.max_contacts_per_event},
    },
    {
        "name": "Maximum 1 message per customer per 24h",
        "kind": PolicyKind.CAP,
        "applies_to": _MESSAGE_ACTIONS,
        "rule": {"field": "counts.messages_24h", "op": "gte", "value": settings.max_messages_per_customer_24h},
    },
    {
        "name": "Maximum 5 messages per customer per 7 days",
        "kind": PolicyKind.CAP,
        "applies_to": _MESSAGE_ACTIONS,
        "rule": {"field": "counts.messages_7d", "op": "gte", "value": settings.max_messages_per_customer_7d},
    },
    {
        "name": "No retries on expired_card / mandate_revoked",
        "kind": PolicyKind.HARD_BLOCK,
        "applies_to": _RETRY_ACTIONS,
        "rule": {"field": "event.cause_code", "op": "in", "value": ["expired_card", "mandate_revoked"]},
    },
    {
        "name": "Maximum 4 mandate retry attempts",
        "kind": PolicyKind.CAP,
        "applies_to": _RETRY_ACTIONS,
        "rule": {"field": "counts.mandate_retry_count", "op": "gte", "value": settings.max_mandate_retry_attempts},
    },
    {
        "name": "No incentives to flagged farmers",
        "kind": PolicyKind.HARD_BLOCK,
        "applies_to": [Action.NUDGE_INCENTIVE.value],
        "rule": {"field": "customer.farming_tier", "op": "eq", "value": "flagged"},
    },
    {
        # Caps a *parameter* (incentive_bps <= 500), not an action's
        # availability — policy_filter can only remove actions, so it never
        # blocks on this row. decide.py enforces it directly (its incentive
        # search, 4.6) and increments this row's trigger_count itself.
        # Stored here anyway so it's still a real, toggleable DB row (5.4)
        # rather than a fact that only exists in code.
        "name": "Half incentive to watch farmers",
        "kind": PolicyKind.CAP,
        "applies_to": [Action.NUDGE_INCENTIVE.value],
        "rule": {"field": "customer.farming_tier", "op": "eq", "value": "watch"},
    },
    {
        # "Queued, not auto-executed" (9.3): this system has no human-
        # approval queue (that's a stage-7 UI/API concern) — enforced here as
        # "above the threshold, the only paths left are HOLD or
        # ESCALATE_HUMAN," which is what "not auto-executed" means with the
        # tools this action space actually has.
        "name": "Human approval above Rs25,000",
        "kind": PolicyKind.REQUIRE_APPROVAL,
        "applies_to": _AUTO_EXECUTING_ACTIONS,
        "rule": {"field": "event.value_at_risk_paise", "op": "gt", "value": settings.human_approval_threshold_paise},
    },
    {
        "name": "72h cool-down after resolution",
        "kind": PolicyKind.HARD_BLOCK,
        "applies_to": _CONTACT_ACTIONS,
        "rule": {"field": "customer.in_cooldown", "op": "eq", "value": True},
    },
]


def seed_policies(session: Session) -> list[Policy]:
    """Idempotent: returns the existing rows if the 11 are already seeded, otherwise creates them (9.3)."""
    existing = session.exec(select(Policy)).all()
    if len(existing) >= len(DEFAULT_POLICIES):
        return existing
    rows = [Policy(name=p["name"], kind=p["kind"], applies_to=p["applies_to"], rule=p["rule"], enabled=True, authored_by=PolicyAuthoredBy.SYSTEM) for p in DEFAULT_POLICIES]
    session.add_all(rows)
    session.commit()
    for row in rows:
        session.refresh(row)
    return rows
