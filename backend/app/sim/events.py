"""
The event generator (section 6.2/2.4) — carts and renewals, run through the
response oracle to decide whether each one resolves on its own.

Cause codes are drawn from the global 6.3 shares independent of archetype
(matching "decline codes distributed per the shares in section 6.3" from the
same convention used for the frontend fixtures) — archetype instead
modulates *self-recovery probability* on top of a code's base rate (oracle.py).
"""

import random
from dataclasses import dataclass
from datetime import datetime, timedelta

from app.models.billing import CheckoutSession, PaymentAttempt
from app.models.enums import (
    Category,
    CauseCode,
    CheckoutStage,
    Device,
    Gateway,
    Issuer,
    MandateStatus,
    PaymentAttemptStatus,
    PaymentMethod,
    SubscriptionStatus,
    TriggeredBy,
)

from .decline_codes import NEVER_RETRY_CODES, draw_cause_code
from .oracle import resolve_self_recovery
from .population import Archetype, SimCustomer
from .world_params import WorldParams

_CATEGORIES = list(Category)
_PAYMENT_METHODS = list(PaymentMethod)
_DEVICES = list(Device)
_GATEWAYS = list(Gateway)
_ISSUERS = list(Issuer)

# Base probability that a *given* checkout/renewal attempt becomes risk-worthy
# (stalls / declines) rather than succeeding immediately. Not spec-numbered —
# this implementation's own calibration (see oracle.py's calibration note).
_BASE_ABANDON_PROBABILITY = {
    Archetype.SELF_RECOVERER: 0.65,
    Archetype.GENUINELY_STUCK: 0.55,
    Archetype.PRICE_SENSITIVE: 0.50,
    Archetype.FARMER: 0.55,
}
_BASE_RENEWAL_FAILURE_PROBABILITY = 0.15


@dataclass
class GeneratedEvent:
    """One resolved raw-data event, for the run summary (app/sim/run.py)."""

    kind: str  # "abandoned_checkout" | "failed_renewal"
    cause_code: CauseCode
    archetype: Archetype
    abandoned_or_failed: bool  # False if it just succeeded cleanly, no risk at all
    self_recovered: bool
    delay_hours: float | None
    value_at_risk_paise: int


def _cart_value_paise(rng: random.Random) -> int:
    """Long tail: mostly Rs300-2,500, a few above Rs20,000."""
    if rng.random() < 0.06:
        return rng.randint(20_000_00, 60_000_00)
    return rng.randint(300_00, 2_500_00)


def _abandon_probability(sim_customer: SimCustomer) -> float:
    base = _BASE_ABANDON_PROBABILITY[sim_customer.archetype]
    if sim_customer.archetype == Archetype.FARMER:
        base = min(0.95, base + sim_customer.abandon_propensity - 0.35)
    return base


def generate_checkout_event(
    sim_customer: SimCustomer, event_time: datetime, params: WorldParams, rng: random.Random, resolve_immediately: bool = True
) -> tuple[CheckoutSession, list[PaymentAttempt], GeneratedEvent]:
    """
    `resolve_immediately=False` (stage 5's live loop) stops right after the
    first failed attempt — stage=ABANDONED, no follow-up — so an agent can
    decide what to do before the oracle resolves it. `resolve_immediately`
    (the stage-2 default, no agent exists in that standalone demo) resolves
    the whole thing in one call via the implicit-HOLD self-recovery path.
    """
    cart_value_paise = _cart_value_paise(rng)
    delivery_fee_paise = int(cart_value_paise * rng.uniform(0.0, 0.08))

    checkout = CheckoutSession(
        customer_id=sim_customer.row.id,
        cart_value_paise=cart_value_paise,
        item_count=rng.randint(1, 6),
        category=rng.choice(_CATEGORIES),
        delivery_fee_paise=delivery_fee_paise,
        payment_method=rng.choice(_PAYMENT_METHODS),
        stage=CheckoutStage.PAYMENT_INITIATED,
        stage_entered_at=event_time,
        device=rng.choice(_DEVICES),
        started_at=event_time,
    )

    if rng.random() >= _abandon_probability(sim_customer):
        # Clean conversion — no risk event at all.
        checkout.stage = CheckoutStage.PAID
        checkout.completed_at = event_time + timedelta(minutes=rng.uniform(0.5, 4))
        attempt = PaymentAttempt(
            customer_id=sim_customer.row.id,
            checkout_session_id=checkout.id,
            amount_paise=cart_value_paise,
            method=checkout.payment_method.value,
            gateway=rng.choice(_GATEWAYS),
            issuer=rng.choice(_ISSUERS),
            status=PaymentAttemptStatus.SUCCESS,
            attempt_number=1,
            triggered_by=TriggeredBy.CUSTOMER,
            attempted_at=event_time,
        )
        event = GeneratedEvent("abandoned_checkout", CauseCode.UPI_TIMEOUT, sim_customer.archetype, False, False, None, cart_value_paise)
        return checkout, [attempt], event

    cause_code = draw_cause_code(rng)
    failed_attempt = PaymentAttempt(
        customer_id=sim_customer.row.id,
        checkout_session_id=checkout.id,
        amount_paise=cart_value_paise,
        method=checkout.payment_method.value,
        gateway=rng.choice(_GATEWAYS),
        issuer=rng.choice(_ISSUERS),
        status=PaymentAttemptStatus.TIMEOUT if cause_code in (CauseCode.UPI_TIMEOUT, CauseCode.BANK_DOWNTIME) else PaymentAttemptStatus.FAILED,
        decline_code=cause_code,
        attempt_number=1,
        triggered_by=TriggeredBy.CUSTOMER,
        attempted_at=event_time,
    )

    attempts: list[PaymentAttempt] = [failed_attempt]
    if not resolve_immediately:
        checkout.stage = CheckoutStage.ABANDONED
        event = GeneratedEvent("abandoned_checkout", cause_code, sim_customer.archetype, True, False, None, cart_value_paise)
        return checkout, attempts, event

    outcome = resolve_self_recovery(cause_code, sim_customer, event_time, params, rng)
    if outcome.recovered and cause_code not in NEVER_RETRY_CODES:
        recovered_at = event_time + timedelta(hours=outcome.delay_hours)
        checkout.stage = CheckoutStage.PAID
        checkout.completed_at = recovered_at
        attempts.append(
            PaymentAttempt(
                customer_id=sim_customer.row.id,
                checkout_session_id=checkout.id,
                amount_paise=cart_value_paise,
                method=checkout.payment_method.value,
                gateway=rng.choice(_GATEWAYS),
                issuer=rng.choice(_ISSUERS),
                status=PaymentAttemptStatus.SUCCESS,
                attempt_number=2,
                triggered_by=TriggeredBy.CUSTOMER,
                attempted_at=recovered_at,
            )
        )
    else:
        checkout.stage = CheckoutStage.ABANDONED

    event = GeneratedEvent("abandoned_checkout", cause_code, sim_customer.archetype, True, outcome.recovered, outcome.delay_hours, cart_value_paise)
    return checkout, attempts, event


def generate_renewal_event(
    sim_customer: SimCustomer, event_time: datetime, params: WorldParams, rng: random.Random, resolve_immediately: bool = True
) -> tuple[list[PaymentAttempt], GeneratedEvent | None]:
    """See generate_checkout_event's `resolve_immediately` docstring — same contract."""
    subscription = sim_customer.subscription
    if subscription is None:
        return [], None

    mrr_paise = subscription.mrr_paise
    first_attempt = PaymentAttempt(
        customer_id=sim_customer.row.id,
        subscription_id=subscription.id,
        amount_paise=mrr_paise,
        method=subscription.mandate_type.value,
        gateway=rng.choice(_GATEWAYS),
        issuer=rng.choice(_ISSUERS),
        attempt_number=1,
        triggered_by=TriggeredBy.SCHEDULED,
        attempted_at=event_time,
    )

    if rng.random() >= _BASE_RENEWAL_FAILURE_PROBABILITY:
        first_attempt.status = PaymentAttemptStatus.SUCCESS
        subscription.consecutive_failures = 0
        clean_event = GeneratedEvent("failed_renewal", CauseCode.UPI_TIMEOUT, sim_customer.archetype, False, False, None, mrr_paise)
        return [first_attempt], clean_event

    cause_code = draw_cause_code(rng)
    first_attempt.status = PaymentAttemptStatus.TIMEOUT if cause_code in (CauseCode.UPI_TIMEOUT, CauseCode.BANK_DOWNTIME) else PaymentAttemptStatus.FAILED
    first_attempt.decline_code = cause_code
    subscription.consecutive_failures += 1
    subscription.status = SubscriptionStatus.PAST_DUE
    if cause_code == CauseCode.EXPIRED_CARD:
        subscription.mandate_status = MandateStatus.EXPIRED
    elif cause_code == CauseCode.MANDATE_REVOKED:
        subscription.mandate_status = MandateStatus.REVOKED

    attempts = [first_attempt]
    if not resolve_immediately:
        event = GeneratedEvent("failed_renewal", cause_code, sim_customer.archetype, True, False, None, mrr_paise)
        return attempts, event

    outcome = resolve_self_recovery(cause_code, sim_customer, event_time, params, rng)
    if outcome.recovered and cause_code not in NEVER_RETRY_CODES:
        recovered_at = event_time + timedelta(hours=outcome.delay_hours)
        attempts.append(
            PaymentAttempt(
                customer_id=sim_customer.row.id,
                subscription_id=subscription.id,
                amount_paise=mrr_paise,
                method=subscription.mandate_type.value,
                gateway=rng.choice(_GATEWAYS),
                issuer=rng.choice(_ISSUERS),
                status=PaymentAttemptStatus.SUCCESS,
                attempt_number=2,
                triggered_by=TriggeredBy.CUSTOMER,
                attempted_at=recovered_at,
            )
        )
        subscription.status = SubscriptionStatus.ACTIVE
        subscription.consecutive_failures = 0

    event = GeneratedEvent("failed_renewal", cause_code, sim_customer.archetype, True, outcome.recovered, outcome.delay_hours, mrr_paise)
    return attempts, event
