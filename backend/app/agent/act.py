"""
Bounded executors (section 5.4's `actions`/`messages` tables) — records what
the agent decided to dispatch. This module never resolves whether the action
actually *worked*: in production that comes from a payment-gateway webhook
or a message delivery receipt; in this simulator it's app/agent/run.py (the
harness) injecting the oracle's resolution afterward — exactly the boundary
sim/oracle.py's own module docstring describes ("ground truth the agent
never sees").
"""

from datetime import datetime

from sqlmodel import Session

from app.agent.costs import ACTION_DIRECT_COST_PAISE
from app.models.actions import ActionRecord, Message
from app.models.customers import Customer
from app.models.decisions import Decision
from app.models.enums import Action, ActionStatus, Channel, Language, Tone
from app.models.risk_events import RiskEvent

# Job 2 (message composition, 4.4) — templated fallback. Real per-language,
# per-tone LLM composition is future work; matches app/llm/'s fallback-first
# discipline (no ANTHROPIC_API_KEY configured in this environment).
_MESSAGE_TEMPLATES = {
    Action.NUDGE_FREE: "Hi {name}, we noticed your recent payment didn't go through. {extra}Tap here to try again: [link]",
    Action.NUDGE_INCENTIVE: "Hi {name}, complete your order now and save {incentive_pct}%. {extra}[link]",
    Action.ESCALATE_HUMAN: "Hi {name}, one of our team members will reach out shortly to help resolve a recent payment issue.",
}
_CAUSE_EXTRA = {
    "expired_card": "Your card on file may have expired — update it here. ",
    "insufficient_funds": "No rush — retry whenever's convenient. ",
}


def _compose_message_body(action: Action, customer: Customer, risk_event: RiskEvent, incentive_bps: int) -> str:
    template = _MESSAGE_TEMPLATES[action]
    extra = _CAUSE_EXTRA.get(risk_event.cause_code.value if risk_event.cause_code else "", "")
    first_name = customer.display_name.split()[0]
    return template.format(name=first_name, extra=extra, incentive_pct=round(incentive_bps / 100))


def act(session: Session, decision: Decision, risk_event: RiskEvent, customer: Customer, now: datetime) -> ActionRecord | None:
    if decision.chosen_action == Action.HOLD:
        return None  # nothing dispatched — 8.5's case.decided event covers this, not case.acted

    params = decision.chosen_params or {}
    incentive_bps = params.get("incentive_bps", 0)
    incentive_cost_paise = round((incentive_bps / 10_000) * risk_event.value_at_risk_paise) if incentive_bps else 0
    direct_cost_paise = round(ACTION_DIRECT_COST_PAISE[decision.chosen_action])

    if decision.chosen_action == Action.RETRY_SCHEDULED:
        scheduled_for, status, executed_at = datetime.fromisoformat(params["scheduled_for_sim"]), ActionStatus.SCHEDULED, None
    else:
        scheduled_for, status, executed_at = now, ActionStatus.EXECUTED, now

    action_record = ActionRecord(
        decision_id=decision.id,
        risk_event_id=risk_event.id,
        type=decision.chosen_action,
        params=params,
        scheduled_for_sim=scheduled_for,
        executed_at_sim=executed_at,
        status=status,
        cost_paise=direct_cost_paise + incentive_cost_paise,
    )
    session.add(action_record)
    session.commit()
    session.refresh(action_record)

    if decision.chosen_action in (Action.NUDGE_FREE, Action.NUDGE_INCENTIVE, Action.ESCALATE_HUMAN):
        message = Message(
            action_id=action_record.id,
            channel=Channel(params.get("channel", Channel.EMAIL.value)),
            language=Language(params.get("language", customer.preferred_language.value)),
            body=_compose_message_body(decision.chosen_action, customer, risk_event, incentive_bps),
            incentive_bps=incentive_bps,
            tone=Tone.WARM,
            # The guardrail engine re-checking composed output independently
            # (8.6: "the model checks itself, and then we don't trust it and
            # check again") is stage 6 — empty until that engine exists.
            policy_checks_passed=[],
            sent_at_sim=now,
        )
        session.add(message)
        session.commit()

    return action_record
