"""
Farming detection (section 4.5) — a transparent, weighted score. Deliberately
not a black-box model: "you need to explain it in ten seconds on stage, and
an operator needs to defend it if a customer complains."

Every signal below is normalised to [0, 1] before weighting, matching the
spec's own `farming_score = Sum(normalised_signal x weight)` formula exactly.
Requires >= 8 observed checkouts (config.farming_min_observed_checkouts)
before assigning a real score — "otherwise a new customer's first
abandonment looks like a 100% abandon rate" (4.5's own cold-start framing).
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.config import settings
from app.models.actions import ActionRecord, Message
from app.models.billing import CheckoutSession
from app.models.enums import Action, CheckoutStage, FarmingTier
from app.models.risk_events import RiskEvent

_LOOKBACK_DAYS = 90

_WEIGHTS = {
    "abandon_rate": 0.25,
    "post_incentive_conversion_rate": 0.30,
    "incentive_dependency": 0.20,
    "timing_regularity": 0.15,
    "stage_consistency": 0.10,
}

# `timing_regularity`'s own calibration: how many hours of std-dev counts as
# "regular" vs "irregular" — not spec-numbered, this implementation's choice.
# std=0h -> 1.0, std=24h -> 0.5, std->infinity -> 0.0.
_TIMING_REGULARITY_SCALE_HOURS = 24.0


@dataclass(frozen=True)
class FarmingResult:
    score: float
    tier: FarmingTier
    signals: dict[str, float]
    observed_checkouts: int


def _tier_for_score(score: float) -> FarmingTier:
    if score > settings.farming_flagged_threshold:
        return FarmingTier.FLAGGED
    if score >= settings.farming_watch_threshold:
        return FarmingTier.WATCH
    return FarmingTier.NORMAL


def compute_farming_score(session: Session, customer_id: str, now: datetime) -> FarmingResult:
    since = now - timedelta(days=_LOOKBACK_DAYS)
    checkouts = session.exec(
        select(CheckoutSession).where(CheckoutSession.customer_id == customer_id, CheckoutSession.started_at >= since)
    ).all()

    if len(checkouts) < settings.farming_min_observed_checkouts:
        return FarmingResult(score=0.0, tier=FarmingTier.NORMAL, signals={}, observed_checkouts=len(checkouts))

    abandoned = [c for c in checkouts if c.stage == CheckoutStage.ABANDONED]
    recovered = [c for c in checkouts if c.stage == CheckoutStage.PAID and c.completed_at is not None]

    abandon_rate = len(abandoned) / len(checkouts)

    # --- post_incentive_conversion_rate: incentive messages that were
    # followed by that same risk_event's checkout completing within 30 min ---
    # Filtered by customer_id in SQL (via a join through RiskEvent), not
    # fetched globally and checked in Python — this used to scan every
    # NUDGE_INCENTIVE message ever sent, to any customer, on every single
    # farming-score call, with an extra per-row `session.get()` round-trip on
    # top. That turned into the dominant cost of a full-scale run once the ML
    # batching fix (score.py) stopped being the bottleneck.
    customer_incentive_sends = session.exec(
        select(Message, RiskEvent)
        .join(ActionRecord, Message.action_id == ActionRecord.id)
        .join(RiskEvent, ActionRecord.risk_event_id == RiskEvent.id)
        .where(ActionRecord.type == Action.NUDGE_INCENTIVE, Message.sent_at_sim.is_not(None), RiskEvent.customer_id == customer_id)
    ).all()

    if customer_incentive_sends:
        quick_conversions = 0
        for message, event in customer_incentive_sends:
            checkout = next((c for c in checkouts if c.id == event.source_id), None)
            if checkout and checkout.completed_at and message.sent_at_sim and timedelta(0) <= checkout.completed_at - message.sent_at_sim <= timedelta(minutes=30):
                quick_conversions += 1
        post_incentive_conversion_rate = quick_conversions / len(customer_incentive_sends)
    else:
        post_incentive_conversion_rate = 0.0

    # --- incentive_dependency: fraction of completed orders that resolved
    # through a NUDGE_INCENTIVE action rather than converting on their own ---
    if recovered:
        incentive_driven = 0
        for checkout in recovered:
            event = session.exec(select(RiskEvent).where(RiskEvent.source_id == checkout.id)).first()
            if event is None:
                continue
            actions = session.exec(select(ActionRecord).where(ActionRecord.risk_event_id == event.id)).all()
            if any(a.type == Action.NUDGE_INCENTIVE for a in actions):
                incentive_driven += 1
        incentive_dependency = incentive_driven / len(recovered)
    else:
        incentive_dependency = 0.0

    # --- timing_regularity: low variance in the abandon -> convert interval ---
    if len(recovered) >= 2:
        intervals_hours = [(c.completed_at - c.stage_entered_at).total_seconds() / 3600 for c in recovered]
        mean_interval = sum(intervals_hours) / len(intervals_hours)
        variance = sum((h - mean_interval) ** 2 for h in intervals_hours) / len(intervals_hours)
        std_hours = variance**0.5
        timing_regularity = 1.0 / (1.0 + std_hours / _TIMING_REGULARITY_SCALE_HOURS)
    else:
        timing_regularity = 0.0  # not enough recoveries to call a pattern "regular"

    # --- stage_consistency: always abandons at the same checkout step ------
    if abandoned:
        stage_counts: dict[CheckoutStage, int] = {}
        for c in abandoned:
            stage_counts[c.stage] = stage_counts.get(c.stage, 0) + 1
        stage_consistency = max(stage_counts.values()) / len(abandoned)
    else:
        stage_consistency = 0.0

    signals = {
        "abandon_rate": abandon_rate,
        "post_incentive_conversion_rate": post_incentive_conversion_rate,
        "incentive_dependency": incentive_dependency,
        "timing_regularity": timing_regularity,
        "stage_consistency": stage_consistency,
    }
    score = sum(signals[name] * weight for name, weight in _WEIGHTS.items())
    return FarmingResult(score=score, tier=_tier_for_score(score), signals=signals, observed_checkouts=len(checkouts))
