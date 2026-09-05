"""
Outcome attribution (section 4's "verify" stage) + stopping rules (9.4).
Reads only observable DB state — no oracle access. In production this
watches real payment-gateway webhooks; here, app/agent/run.py (the harness)
is what injects the oracle-resolved rows this module then picks up, plus the
one number that genuinely can't come from observation alone
(`counterfactual_recovered_paise` — "sim-only ground truth", 5.4).
"""

from datetime import datetime

from sqlmodel import Session, select

from app.agent.policy import cancel_scheduled_actions
from app.config import settings
from app.models.actions import ActionRecord
from app.models.billing import CheckoutSession, PaymentAttempt, Subscription
from app.models.enums import (
    ActionStatus,
    CheckoutStage,
    PaymentAttemptStatus,
    ResolutionPath,
    RiskEventKind,
    RiskEventStatus,
    SubscriptionStatus,
)
from app.models.outcomes import Outcome
from app.models.risk_events import RiskEvent

__all__ = ["attribute_outcome", "cancel_scheduled_actions"]


def _is_resolved(session: Session, risk_event: RiskEvent) -> tuple[bool, datetime | None, int]:
    """Did the money actually arrive? Pure observation of raw commercial state, no oracle."""
    if risk_event.kind == RiskEventKind.ABANDONED_CHECKOUT:
        checkout = session.get(CheckoutSession, risk_event.source_id)
        if checkout.stage == CheckoutStage.PAID and checkout.completed_at is not None:
            return True, checkout.completed_at, checkout.cart_value_paise
        return False, None, 0

    subscription = session.get(Subscription, risk_event.source_id)
    if subscription.status == SubscriptionStatus.ACTIVE and subscription.consecutive_failures == 0:
        latest_success = session.exec(
            select(PaymentAttempt)
            .where(PaymentAttempt.subscription_id == subscription.id, PaymentAttempt.status == PaymentAttemptStatus.SUCCESS)
            .order_by(PaymentAttempt.attempted_at.desc())
        ).first()
        if latest_success is not None and latest_success.attempted_at >= risk_event.detected_at_sim:
            return True, latest_success.attempted_at, subscription.mrr_paise
    return False, None, 0


def attribute_outcome(
    session: Session,
    risk_event: RiskEvent,
    now: datetime,
    total_cost_paise: int,
    counterfactual_recovered_paise: int,
    opted_out: bool = False,
) -> Outcome | None:
    """
    Call once per event that might now be closeable. Returns None if the
    event is still genuinely open (no stopping rule applies yet) — callers
    should just try again on a later sim day.
    """
    resolved, resolved_at, recovered_paise = _is_resolved(session, risk_event)
    actions = session.exec(select(ActionRecord).where(ActionRecord.risk_event_id == risk_event.id)).all()
    settled_actions = [a for a in actions if a.status in (ActionStatus.EXECUTED, ActionStatus.CANCELLED)]

    if resolved:
        cancel_scheduled_actions(session, risk_event.id, "event resolved")
        resolution_path = ResolutionPath.SELF_RECOVERED if not actions else ResolutionPath.AGENT_RECOVERED
        risk_event.status = RiskEventStatus.RESOLVED
    elif opted_out:
        resolution_path, resolved_at = ResolutionPath.LOST, now
        risk_event.status = RiskEventStatus.RESOLVED
        cancel_scheduled_actions(session, risk_event.id, "customer opted out")
    elif (now - risk_event.detected_at_sim).days >= settings.event_expiry_sim_days:
        resolution_path, resolved_at = ResolutionPath.EXPIRED, now
        risk_event.status = RiskEventStatus.EXPIRED
        cancel_scheduled_actions(session, risk_event.id, "event expired (14 sim-days, 9.4)")
    elif len(settled_actions) >= settings.lost_after_n_actions:
        resolution_path, resolved_at = ResolutionPath.LOST, now
        risk_event.status = RiskEventStatus.RESOLVED
        cancel_scheduled_actions(session, risk_event.id, "no movement after repeated actions (9.4)")
    else:
        return None  # still open

    margin_rate = risk_event.margin_rate_bps / 10_000
    net_profit_paise = round(recovered_paise * margin_rate) - total_cost_paise
    incremental_profit_paise = net_profit_paise - round(counterfactual_recovered_paise * margin_rate)

    outcome = Outcome(
        risk_event_id=risk_event.id,
        resolved=resolved,
        resolution_path=resolution_path,
        recovered_paise=recovered_paise,
        total_cost_paise=total_cost_paise,
        net_profit_paise=net_profit_paise,
        counterfactual_recovered_paise=counterfactual_recovered_paise,
        incremental_profit_paise=incremental_profit_paise,
        customer_opted_out=opted_out,
        resolved_at_sim=resolved_at,
    )
    session.add(outcome)
    session.add(risk_event)
    session.commit()
    session.refresh(outcome)
    return outcome
