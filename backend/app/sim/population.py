"""
The population generator (section 6.2). Four correlated behavioural
archetypes, not independent uniform draws — "which produce a mush where no
strategy beats any other."
"""

import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum

from app.models.billing import Subscription
from app.models.customers import Customer
from app.models.enums import Language, MandateStatus, MandateType, PlanName, Segment, SubscriptionStatus

from . import pools
from .world_params import WorldParams


class Archetype(str, Enum):
    """
    Ground truth, sim-only — deliberately not a `customers` column (5.4 has
    no archetype field): "the agent never sees it" (section 6.4), same
    principle as `salary_day_of_month` vs `inferred_salary_day`.
    """

    SELF_RECOVERER = "self_recoverer"
    GENUINELY_STUCK = "genuinely_stuck"
    PRICE_SENSITIVE = "price_sensitive"
    FARMER = "farmer"


# Relative shares within the archetypes NOT specified by a world-param knob
# (section 6.2's 30/35/20 split for self_recoverer/genuinely_stuck/
# price_sensitive). `farmer_share` is itself an adversarial knob (6.5) and
# takes whatever's left, so these three are renormalised to fill (1 - farmer_share).
_BASE_NON_FARMER_SHARES = {
    Archetype.SELF_RECOVERER: 0.30,
    Archetype.GENUINELY_STUCK: 0.35,
    Archetype.PRICE_SENSITIVE: 0.20,
}


def _archetype_weights(farmer_share: float) -> dict[Archetype, float]:
    remaining = max(0.0, 1.0 - farmer_share)
    base_total = sum(_BASE_NON_FARMER_SHARES.values())  # 0.85
    weights = {a: share / base_total * remaining for a, share in _BASE_NON_FARMER_SHARES.items()}
    weights[Archetype.FARMER] = farmer_share
    return weights


@dataclass
class SimCustomer:
    row: Customer
    archetype: Archetype
    # Farmer-only, sim-internal: climbs as they extract incentives (6.2) —
    # the agent's farming_score (4.5) is a *separate*, agent-computed signal
    # derived from observed behaviour, not this ground-truth propensity.
    abandon_propensity: float
    has_subscription: bool
    subscription: Subscription | None = None


_SEGMENT_BY_TENURE_DAYS = [
    (90, Segment.NEW),
    (365, Segment.CASUAL),
    (365 * 3, Segment.REGULAR),
]

# Deltas around `params.margin_rate_bps` (the sweepable "Your margins are
# unrealistic" knob, 6.5 — default 2200bps) rather than hardcoded absolutes,
# so sweeping it actually moves every customer's margin, not just the
# illustrative REGULAR-segment default. At the default 2200bps these
# reproduce the original fixed table (1800/2000/2200/2600) exactly.
_MARGIN_BPS_DELTA_BY_SEGMENT = {
    Segment.NEW: -400,
    Segment.CASUAL: -200,
    Segment.REGULAR: 0,
    Segment.POWER: 400,
}


def _segment_for_tenure(tenure_days: int) -> Segment:
    for max_days, segment in _SEGMENT_BY_TENURE_DAYS:
        if tenure_days <= max_days:
            return segment
    return Segment.POWER


def _preferred_language(city: str, rng: random.Random) -> Language:
    if pools.CITY_IS_TAMIL.get(city) and rng.random() < 0.6:
        return Language.TA
    # Hinglish is a genuine differentiator for an Indian judging panel (4.6) —
    # weighted as the majority default rather than an afterthought.
    return rng.choices([Language.HINGLISH, Language.EN, Language.TA], weights=[0.55, 0.35, 0.10])[0]


def generate_population(n: int, sim_start: datetime, params: WorldParams, rng: random.Random) -> list[SimCustomer]:
    weights = _archetype_weights(params.farmer_share)
    archetypes = list(weights.keys())
    archetype_probs = list(weights.values())

    population: list[SimCustomer] = []
    for _ in range(n):
        archetype = rng.choices(archetypes, weights=archetype_probs)[0]

        first = rng.choice(pools.FIRST_NAMES)
        last = rng.choice(pools.LAST_NAMES)
        city = rng.choices(pools.CITY_NAMES, weights=pools.CITY_WEIGHTS)[0]

        tenure_days = rng.randint(1, 365 * 5)
        segment = _segment_for_tenure(tenure_days)
        signup_at = sim_start - timedelta(days=tenure_days)

        margin_bps = params.margin_rate_bps + _MARGIN_BPS_DELTA_BY_SEGMENT[segment] + rng.randint(-150, 150)
        ltv_expected_paise = rng.randint(5_000_00, 80_000_00) * {
            Segment.NEW: 1, Segment.CASUAL: 2, Segment.REGULAR: 4, Segment.POWER: 8,
        }[segment] // 4

        customer = Customer(
            display_name=f"{first} {last}",
            email=f"{first.lower()}.{last.lower()}{rng.randint(1, 999)}@example.com",
            phone=f"+91{rng.randint(7000000000, 9999999999)}",
            city=city,
            preferred_language=_preferred_language(city, rng),
            whatsapp_opted_in=rng.random() < 0.82,
            email_opted_in=rng.random() < 0.90,
            signup_at=signup_at,
            segment=segment,
            ltv_realised_paise=int(ltv_expected_paise * rng.uniform(0.2, 0.8)),
            ltv_expected_paise=ltv_expected_paise,
            gross_margin_bps=max(500, margin_bps),
            salary_day_of_month=rng.randint(1, 28),
            inferred_salary_day=None,  # the agent has to work this out (stage 5) — sim keeps it private
            hard_optout=rng.random() < 0.02,
        )

        # Farmers "start as a self-recoverer" (6.2) — low initial propensity,
        # climbs only once an agent actually sends incentives (stage 5).
        abandon_propensity = 0.35 if archetype == Archetype.FARMER else 0.0

        sim_customer = SimCustomer(row=customer, archetype=archetype, abandon_propensity=abandon_propensity, has_subscription=False)

        # ~40% of the population also carries a subscription (SaaS renewal
        # vertical, 2.4) — the rest are checkout-only (e-commerce vertical).
        if rng.random() < 0.40:
            sim_customer.has_subscription = True
            sim_customer.subscription = Subscription(
                customer_id=customer.id,  # SQLModel resolves default_factory ids at construction, not on commit
                plan_name=rng.choice(list(PlanName)),
                mrr_paise=rng.randint(199_00, 4_999_00),
                billing_day=rng.randint(1, 28),
                mandate_type=rng.choice(list(MandateType)),
                mandate_status=MandateStatus.ACTIVE,
                consecutive_failures=0,
                status=SubscriptionStatus.ACTIVE,
                started_at=signup_at,
            )

        population.append(sim_customer)

    return population
