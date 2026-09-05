"""
Model inference + feature-building (section 4.2's `p_baseline`/`p_recover(a)`
terms, section 7.5's CIs) — turns a diagnosed risk_event into real numbers by
querying the same DB tables detect.py/diagnose.py just wrote to, then calling
the stage-4 artifact (app/ml/predict.py) exactly the way it was designed to
be called.
"""

from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

from sqlmodel import Session, select

from app.agent.farming import compute_farming_score
from app.ml.features import FeatureInputs, to_feature_row
from app.ml.predict import ModelBundle, PredictionCI, load_model_bundle, predict_batch_with_ci, predict_with_ci
from app.models.actions import ActionRecord, Message
from app.models.billing import CheckoutSession, PaymentAttempt, Subscription
from app.models.customers import Customer
from app.models.enums import Action, CheckoutStage, PaymentAttemptStatus, RiskEventKind
from app.models.outcomes import Outcome
from app.models.risk_events import RiskEvent

DEFAULT_ARTIFACT_PATH = Path(__file__).resolve().parent.parent / "ml" / "artifacts" / "hold_models.joblib"
NON_HOLD_ACTIONS = [a for a in Action if a != Action.HOLD]

_FAILED_STATUSES = (PaymentAttemptStatus.FAILED, PaymentAttemptStatus.TIMEOUT)
_MISSING = "n/a"

_bundle_cache: ModelBundle | None = None


def load_default_bundle() -> ModelBundle:
    global _bundle_cache
    if _bundle_cache is None:
        _bundle_cache = load_model_bundle(DEFAULT_ARTIFACT_PATH)
    return _bundle_cache


def _latest_failed_attempt(session: Session, risk_event: RiskEvent) -> PaymentAttempt | None:
    column = PaymentAttempt.checkout_session_id if risk_event.kind == RiskEventKind.ABANDONED_CHECKOUT else PaymentAttempt.subscription_id
    return session.exec(
        select(PaymentAttempt).where(column == risk_event.source_id, PaymentAttempt.status.in_(_FAILED_STATUSES)).order_by(PaymentAttempt.attempt_number.desc())
    ).first()


def infer_salary_day(session: Session, customer: Customer) -> int | None:
    """
    4.6: "infer from the day-of-month distribution of the customer's past
    successful payments" — 7.4: "this single feature is where most of the
    retry-timing uplift lives." A real inference (mode of observed successful
    payment days), not the sim's ground-truth `salary_day_of_month` — the
    agent only ever sees what a real system would: its own payment history.
    """
    successes = session.exec(
        select(PaymentAttempt).where(PaymentAttempt.customer_id == customer.id, PaymentAttempt.status == PaymentAttemptStatus.SUCCESS)
    ).all()
    if len(successes) < 2:
        return None
    day_counts = Counter(a.attempted_at.day for a in successes)
    return day_counts.most_common(1)[0][0]


def _days_to_salary_day(now: datetime, inferred_salary_day: int | None) -> float | None:
    if inferred_salary_day is None:
        return None
    days_in_month = 28
    return float((inferred_salary_day - now.day) % days_in_month)


def _value_percentile_for_customer(session: Session, customer_id: str, value_at_risk: int) -> float:
    past_values = session.exec(select(RiskEvent.value_at_risk_paise).where(RiskEvent.customer_id == customer_id)).all()
    if not past_values:
        return 0.5  # no history yet — neutral, matches score.py's imputation convention elsewhere
    all_values = sorted([*past_values, value_at_risk])
    rank = sum(1 for v in all_values if v <= value_at_risk)
    return rank / len(all_values)


def _gateway_success_rate_1h(session: Session, gateway, now: datetime) -> float:
    since = now - timedelta(hours=1)
    recent = session.exec(select(PaymentAttempt).where(PaymentAttempt.gateway == gateway, PaymentAttempt.attempted_at >= since, PaymentAttempt.attempted_at <= now)).all()
    if not recent:
        return 0.95  # no recent volume on this gateway to measure — assume healthy
    successes = sum(1 for a in recent if a.status == PaymentAttemptStatus.SUCCESS)
    return successes / len(recent)


def build_feature_inputs(session: Session, risk_event: RiskEvent, customer: Customer, now: datetime) -> FeatureInputs:
    attempt = _latest_failed_attempt(session, risk_event)
    attempt_number = attempt.attempt_number if attempt else 0

    prior_events = session.exec(select(RiskEvent).where(RiskEvent.customer_id == customer.id, RiskEvent.id != risk_event.id)).all()
    prior_outcomes = []
    if prior_events:
        prior_outcomes = session.exec(select(Outcome).where(Outcome.risk_event_id.in_([e.id for e in prior_events]))).all()
    prior_recovery_count = sum(1 for o in prior_outcomes if o.resolved)
    prior_abandon_count = sum(1 for e in prior_events if e.kind == RiskEventKind.ABANDONED_CHECKOUT)

    since_90d = now - timedelta(days=90)
    checkouts_90d = session.exec(select(CheckoutSession).where(CheckoutSession.customer_id == customer.id, CheckoutSession.started_at >= since_90d)).all()
    abandon_rate_90d = (sum(1 for c in checkouts_90d if c.stage == CheckoutStage.ABANDONED) / len(checkouts_90d)) if checkouts_90d else 0.0

    farming = compute_farming_score(session, customer.id, now)
    customer.farming_score = round(farming.score, 3)
    customer.farming_tier = farming.tier
    customer.farming_signals = farming.signals
    session.add(customer)
    session.commit()

    last_success = session.exec(
        select(PaymentAttempt).where(PaymentAttempt.customer_id == customer.id, PaymentAttempt.status == PaymentAttemptStatus.SUCCESS).order_by(PaymentAttempt.attempted_at.desc())
    ).first()
    days_since_last_purchase = (now - last_success.attempted_at).days if last_success else 999

    since_7d, since_30d = now - timedelta(days=7), now - timedelta(days=30)
    sent_messages = session.exec(
        select(Message, ActionRecord)
        .join(ActionRecord, Message.action_id == ActionRecord.id)
        .join(RiskEvent, ActionRecord.risk_event_id == RiskEvent.id)
        .where(RiskEvent.customer_id == customer.id, Message.sent_at_sim.is_not(None), Message.sent_at_sim >= since_30d)
    ).all()
    messages_received_30d = len(sent_messages)
    messages_received_7d = sum(1 for m, _ in sent_messages if m.sent_at_sim >= since_7d)

    inferred_salary_day = infer_salary_day(session, customer)
    if inferred_salary_day != customer.inferred_salary_day:
        customer.inferred_salary_day = inferred_salary_day
        session.add(customer)
        session.commit()

    if risk_event.kind == RiskEventKind.ABANDONED_CHECKOUT:
        checkout = session.get(CheckoutSession, risk_event.source_id)
        payment_method = checkout.payment_method.value
        cart_category = checkout.category.value
        device = checkout.device.value
        checkout_stage = checkout.stage.value
        delivery_fee_ratio = (checkout.delivery_fee_paise / checkout.cart_value_paise) if checkout.cart_value_paise else 0.0
    else:
        subscription = session.get(Subscription, risk_event.source_id)
        payment_method = subscription.mandate_type.value
        cart_category = _MISSING
        device = _MISSING
        checkout_stage = _MISSING
        delivery_fee_ratio = 0.0

    return FeatureInputs(
        tenure_days=(now - customer.signup_at).days,
        segment=customer.segment.value,
        ltv_expected=customer.ltv_expected_paise,
        gross_margin_bps=customer.gross_margin_bps,
        prior_recovery_count=prior_recovery_count,
        prior_abandon_count=prior_abandon_count,
        abandon_rate_90d=abandon_rate_90d,
        farming_score=float(customer.farming_score),
        days_since_last_purchase=days_since_last_purchase,
        messages_received_7d=messages_received_7d,
        messages_received_30d=messages_received_30d,
        prior_optout_signals=int(customer.hard_optout),
        preferred_language=customer.preferred_language.value,
        whatsapp_opted_in=customer.whatsapp_opted_in,
        kind=risk_event.kind.value,
        value_at_risk=risk_event.value_at_risk_paise,
        value_percentile_for_customer=_value_percentile_for_customer(session, customer.id, risk_event.value_at_risk_paise),
        cause_code=risk_event.cause_code.value if risk_event.cause_code else _MISSING,
        cause_confidence=float(risk_event.cause_confidence or 0.0),
        attempt_number=attempt_number,
        hour_of_day=now.hour,
        day_of_month=now.day,
        days_to_inferred_salary_day=_days_to_salary_day(now, inferred_salary_day),
        is_weekend=now.weekday() >= 5,
        days_since_event_detected=(now - risk_event.detected_at_sim).days,
        payment_method=payment_method,
        issuer=attempt.issuer.value if attempt else _MISSING,
        gateway=attempt.gateway.value if attempt else _MISSING,
        gateway_success_rate_1h=_gateway_success_rate_1h(session, attempt.gateway, now) if attempt else 0.95,
        cart_category=cart_category,
        delivery_fee_ratio=delivery_fee_ratio,
        device=device,
        checkout_stage_at_abandon=checkout_stage,
    )


_ARMS = ["p_baseline", *[a.value for a in NON_HOLD_ACTIONS], "p_optout"]


def score_event(bundle: ModelBundle, inputs: FeatureInputs) -> dict[str, PredictionCI]:
    """Keys: "p_baseline", each non-HOLD Action's `.value`, and "p_optout" — matches predict.py's `arm` convention exactly."""
    row = to_feature_row(inputs)
    return {arm: predict_with_ci(bundle, arm, row) for arm in _ARMS}


def score_events_batch(bundle: ModelBundle, inputs_list: list[FeatureInputs]) -> list[dict[str, PredictionCI]]:
    """
    Same per-event result shape as `score_event`, but scores N events in one
    pass per arm instead of one event at a time. `predict_with_ci` measured
    at ~50ms of *fixed* per-call overhead regardless of row count (a
    `CalibratedClassifierCV` quirk) — at 7 arms x 20 bootstrap models that's
    several seconds per event scored individually. Batching a day's worth of
    new events into one call per arm pays that fixed cost once per day
    instead of once per event; this is what makes the live loop's standalone
    run finish in minutes instead of hours.
    """
    if not inputs_list:
        return []
    rows = [to_feature_row(i) for i in inputs_list]
    per_arm = {arm: predict_batch_with_ci(bundle, arm, rows) for arm in _ARMS}
    return [{arm: per_arm[arm][i] for arm in _ARMS} for i in range(len(inputs_list))]
