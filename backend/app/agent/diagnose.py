"""
Cause classification (section 4.4 job 1's data half — the narrative half is
lazy per that same section; see app/llm/narrate.py). For both verticals, the
decline code is read directly off the payment gateway's own response
(`payment_attempts.decline_code`) — real, gateway-reported data in
production (Razorpay/PayU/Cashfree all return a decline reason on a failed
charge), not sim-only ground truth. Reading it here isn't "cheating": a live
integration would get the same code from the same webhook payload.
"""

from sqlmodel import Session, select

from app.llm.narrate import templated_one_liner
from app.models.billing import PaymentAttempt
from app.models.enums import PaymentAttemptStatus, RiskEventKind, RiskEventStatus
from app.models.risk_events import RiskEvent

_FAILED_STATUSES = (PaymentAttemptStatus.FAILED, PaymentAttemptStatus.TIMEOUT)
# Gateway-reported, so confidence is high but not 1.0 — gateways occasionally
# mis-tag or return a catch-all code (do_not_honour absorbs a lot of this in
# reality). Not spec-numbered, this implementation's calibration.
_GATEWAY_REPORTED_CONFIDENCE = 0.95


def _latest_failed_attempt(session: Session, risk_event: RiskEvent) -> PaymentAttempt | None:
    column = PaymentAttempt.checkout_session_id if risk_event.kind == RiskEventKind.ABANDONED_CHECKOUT else PaymentAttempt.subscription_id
    return session.exec(
        select(PaymentAttempt).where(column == risk_event.source_id, PaymentAttempt.status.in_(_FAILED_STATUSES)).order_by(PaymentAttempt.attempt_number.desc())
    ).first()


def diagnose(session: Session, risk_event: RiskEvent) -> RiskEvent:
    attempt = _latest_failed_attempt(session, risk_event)
    if attempt is not None and attempt.decline_code is not None:
        risk_event.cause_code = attempt.decline_code
        risk_event.cause_confidence = _GATEWAY_REPORTED_CONFIDENCE
        risk_event.cause_narrative = templated_one_liner(risk_event.cause_code, attempt.attempt_number)
    else:
        # No payment attempt was ever made (abandoned before a payment method
        # was even charged) — there is no decline code to read, only a guess.
        risk_event.cause_code = None
        risk_event.cause_confidence = 0.0
        risk_event.cause_narrative = "Abandoned before a payment method was charged."

    risk_event.status = RiskEventStatus.DIAGNOSED
    session.add(risk_event)
    session.commit()
    session.refresh(risk_event)
    return risk_event
