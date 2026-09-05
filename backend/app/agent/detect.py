"""
Sweep queries (section 3's architecture diagram, section 5.5's index note) —
reads the raw commercial tables sim/sweep.py (or a live equivalent) writes
and creates `risk_events` rows for anything not already being tracked.
Vertical-agnostic from here down (5.3): both checkout abandonment and
renewal failure become the same `RiskEvent` shape.
"""

from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.models._base import utcnow
from app.models.billing import CheckoutSession, PaymentAttempt, Subscription
from app.models.customers import Customer
from app.models.enums import (
    Arm,
    CheckoutStage,
    PaymentAttemptStatus,
    RiskEventKind,
    RiskEventStatus,
    SubscriptionStatus,
)
from app.models.risk_events import RiskEvent

# MRR x expected remaining months — not spec-numbered (5.4 only says "MRR x
# expected months"); 3 months is this implementation's calibration.
_RENEWAL_EXPECTED_MONTHS = 3

_OPEN_STATUSES = (
    RiskEventStatus.DETECTED,
    RiskEventStatus.DIAGNOSED,
    RiskEventStatus.SCORED,
    RiskEventStatus.DECIDED,
    RiskEventStatus.ACTING,
)


def _detect_abandoned_checkouts(session: Session, run_id: str, now: datetime, arm: Arm) -> list[RiskEvent]:
    # 5.5: the checkout_sessions(stage, stage_entered_at) index exists exactly
    # for this query.
    candidates = session.exec(select(CheckoutSession).where(CheckoutSession.stage == CheckoutStage.ABANDONED)).all()
    created = []
    for checkout in candidates:
        already_detected = session.exec(select(RiskEvent).where(RiskEvent.source_id == checkout.id)).first()
        if already_detected is not None:
            continue
        customer = session.get(Customer, checkout.customer_id)
        event = RiskEvent(
            run_id=run_id,
            customer_id=checkout.customer_id,
            kind=RiskEventKind.ABANDONED_CHECKOUT,
            source_id=checkout.id,
            value_at_risk_paise=checkout.cart_value_paise,
            margin_rate_bps=customer.gross_margin_bps,
            # The checkout's *own* timestamp, not the sweep's invocation time
            # (`now`) — a sweep that runs once/day at a fixed hour would
            # otherwise stamp every event with that same hour, so a
            # quiet-hours guardrail (9.3) evaluated against it would either
            # always or never fire regardless of when the failure actually
            # happened. `detected_at_wall` (below) is genuinely "when the
            # sweep found it"; `detected_at_sim` is "when it happened."
            detected_at_sim=checkout.stage_entered_at,
            detected_at_wall=utcnow(),
            detection_rule="checkout_stage_abandoned",
            arm=arm,
        )
        session.add(event)
        created.append(event)
    return created


def _detect_failed_renewals(session: Session, run_id: str, now: datetime, arm: Arm) -> list[RiskEvent]:
    candidates = session.exec(select(Subscription).where(Subscription.status == SubscriptionStatus.PAST_DUE)).all()
    created = []
    for subscription in candidates:
        open_event = session.exec(
            select(RiskEvent).where(RiskEvent.source_id == subscription.id, RiskEvent.status.in_(_OPEN_STATUSES))
        ).first()
        if open_event is not None:
            continue  # already being worked

        latest_failed = session.exec(
            select(PaymentAttempt)
            .where(
                PaymentAttempt.subscription_id == subscription.id,
                PaymentAttempt.status.in_([PaymentAttemptStatus.FAILED, PaymentAttemptStatus.TIMEOUT]),
            )
            .order_by(PaymentAttempt.attempted_at.desc())
        ).first()
        if latest_failed is None:
            continue

        # A subscription can fail, get resolved, then fail again later — only
        # skip if we've already made a risk_event for *this specific* failure.
        already_detected = session.exec(
            select(RiskEvent).where(RiskEvent.source_id == subscription.id, RiskEvent.detected_at_sim >= latest_failed.attempted_at - timedelta(minutes=1))
        ).first()
        if already_detected is not None:
            continue

        customer = session.get(Customer, subscription.customer_id)
        event = RiskEvent(
            run_id=run_id,
            customer_id=subscription.customer_id,
            kind=RiskEventKind.FAILED_RENEWAL,
            source_id=subscription.id,
            value_at_risk_paise=subscription.mrr_paise * _RENEWAL_EXPECTED_MONTHS,
            margin_rate_bps=customer.gross_margin_bps,
            detected_at_sim=latest_failed.attempted_at,  # the failed attempt's own timestamp — see the checkout branch's comment above
            detected_at_wall=utcnow(),
            detection_rule="renewal_payment_failed",
            arm=arm,
        )
        session.add(event)
        created.append(event)
    return created


def detect_new_risk_events(session: Session, run_id: str, now: datetime, arm: Arm = Arm.AGENT) -> list[RiskEvent]:
    created = _detect_abandoned_checkouts(session, run_id, now, arm) + _detect_failed_renewals(session, run_id, now, arm)
    session.commit()
    for event in created:
        session.refresh(event)
    return created
