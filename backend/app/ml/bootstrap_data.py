"""
Section 6.6's warm-up phase: assign a UNIFORMLY RANDOM action (all six,
equal weight) to a batch of synthetic risk events and resolve each through
the full p_true_recover/p_optout oracle (app/sim/oracle.py) — not a live
agent, since none exists yet (stage 5). This is what produces the unbiased,
all-arms-covered labelled dataset models A/B/C train on (~4,000 events,
6.6 point 1).

Deliberately NOT persisted through risk_events/decisions/actions/outcomes —
those tables hold live-run case records for the UI (stage 5+). This is
training data only, returned as a pandas DataFrame.

Known simplifications, flagged rather than hidden (11.2's "do not fudge the
numbers" discipline extends to "do not hide the approximations either"):
- `days_to_inferred_salary_day` uses the sim's ground-truth
  `salary_day_of_month` as a stand-in for the day-of-month clustering
  inference `detect.py` will eventually compute (stage 5) — that inference
  doesn't exist yet. Retrain once it does.
- `messages_sent_7d` per event is a small random draw, not a tracked
  history — warm-up sampling is i.i.d. per event, not a sequential run.
- `value_percentile_for_customer` is approximated as a percentile over the
  whole generated batch, not each customer's own history (i.i.d. sampling
  mostly produces one event per customer, so there is no real history yet).
- `gateway_success_rate_1h` and the other point-in-time context fields are
  synthesized plausibly rather than aggregated from real attempt history.
"""

import bisect
import random
from dataclasses import dataclass
from datetime import datetime, timedelta

import pandas as pd

from app.models.enums import Action, Category, CauseCode, CheckoutStage, Device, Gateway, Issuer, PaymentMethod
from app.sim.decline_codes import draw_cause_code
from app.sim.oracle import p_optout, p_true_recover
from app.sim.population import SimCustomer, generate_population
from app.sim.world_params import WorldParams

from .features import FeatureInputs, to_feature_row

ALL_ACTIONS: list[Action] = list(Action)

_GATEWAYS = list(Gateway)
_ISSUERS = list(Issuer)
_CATEGORIES = list(Category)
_DEVICES = list(Device)
_PAYMENT_METHODS = list(PaymentMethod)
_MISSING = "n/a"  # context fields that don't apply to a renewal event (no cart, no device, ...)


@dataclass(frozen=True)
class WarmupRow:
    features: dict
    action: Action
    resolved: bool
    opted_out: bool


def _days_to_salary_day(event_time: datetime, salary_day_of_month: int) -> int:
    days_in_month = 28
    return (salary_day_of_month - event_time.day) % days_in_month


def _sample_event_kind_and_value(sim_customer: SimCustomer, rng: random.Random) -> tuple[str, int]:
    if sim_customer.has_subscription and rng.random() < 0.5:
        mrr = sim_customer.subscription.mrr_paise
        return "failed_renewal", mrr * rng.randint(2, 6)  # MRR x expected remaining months (5.4)
    if rng.random() < 0.06:
        cart_value = rng.randint(20_000_00, 60_000_00)
    else:
        cart_value = rng.randint(300_00, 2_500_00)
    return "abandoned_checkout", cart_value


def _sample_events_per_customer(rng: random.Random) -> int:
    # A handful of customers generate more than one risk event across the
    # warm-up window; most generate 0 or 1. Not spec-numbered — tuned so
    # population_size=2000 over the default 60-day warmup lands in the same
    # order of magnitude as 6.6's "roughly 4,000 labelled events".
    return rng.choices([0, 1, 2, 3], weights=[0.35, 0.40, 0.18, 0.07])[0]


def generate_warmup_dataset(params: WorldParams, sim_start: datetime, warmup_days: int, rng: random.Random) -> pd.DataFrame:
    population = generate_population(params.population_size, sim_start, params, rng)

    pending: list[dict] = []
    raw_values: list[int] = []
    for sim_customer in population:
        for _ in range(_sample_events_per_customer(rng)):
            kind, value_at_risk = _sample_event_kind_and_value(sim_customer, rng)
            cause_code = draw_cause_code(rng)
            event_day = rng.randint(0, max(warmup_days - 1, 0))
            event_time = sim_start - timedelta(days=warmup_days) + timedelta(days=event_day, hours=rng.uniform(0, 24))
            action = rng.choice(ALL_ACTIONS)
            messages_sent_7d = rng.choices([0, 1, 2], weights=[0.7, 0.22, 0.08])[0]

            p_recover = p_true_recover(cause_code, sim_customer, action, event_time, params, messages_sent_7d)
            resolved = rng.random() < p_recover

            opted_out = False
            if action != Action.HOLD:
                p_opt = p_optout(action, messages_sent_7d, (event_time - sim_customer.row.signup_at).days, params)
                opted_out = rng.random() < p_opt

            pending.append(
                {
                    "sim_customer": sim_customer,
                    "kind": kind,
                    "value_at_risk": value_at_risk,
                    "cause_code": cause_code,
                    "event_time": event_time,
                    "action": action,
                    "messages_sent_7d": messages_sent_7d,
                    "resolved": resolved,
                    "opted_out": opted_out,
                }
            )
            raw_values.append(value_at_risk)

    raw_values.sort()

    def _percentile(value: int) -> float:
        idx = bisect.bisect_left(raw_values, value)
        return idx / max(len(raw_values) - 1, 1)

    rows: list[WarmupRow] = []
    for p in pending:
        sim_customer: SimCustomer = p["sim_customer"]
        customer = sim_customer.row
        event_time: datetime = p["event_time"]
        cause_code: CauseCode = p["cause_code"]
        kind: str = p["kind"]

        if kind == "failed_renewal" and sim_customer.subscription is not None:
            payment_method = sim_customer.subscription.mandate_type.value
            cart_category = _MISSING
            device = _MISSING
            checkout_stage = _MISSING
            delivery_fee_ratio = 0.0
        else:
            payment_method = rng.choice(_PAYMENT_METHODS).value
            cart_category = rng.choice(_CATEGORIES).value
            device = rng.choice(_DEVICES).value
            checkout_stage = CheckoutStage.PAYMENT_INITIATED.value
            delivery_fee_ratio = round(rng.uniform(0.0, 0.08), 4)

        inputs = FeatureInputs(
            tenure_days=(event_time - customer.signup_at).days,
            segment=customer.segment.value,
            ltv_expected=customer.ltv_expected_paise,
            gross_margin_bps=customer.gross_margin_bps,
            prior_recovery_count=rng.randint(0, 6),
            prior_abandon_count=rng.randint(0, 10),
            abandon_rate_90d=round(rng.uniform(0.05, 0.9), 3),
            farming_score=float(customer.farming_score),
            days_since_last_purchase=rng.randint(0, 60),
            messages_received_7d=p["messages_sent_7d"],
            messages_received_30d=p["messages_sent_7d"] + rng.randint(0, 4),
            prior_optout_signals=0,
            preferred_language=customer.preferred_language.value,
            whatsapp_opted_in=customer.whatsapp_opted_in,
            kind=kind,
            value_at_risk=p["value_at_risk"],
            value_percentile_for_customer=_percentile(p["value_at_risk"]),
            cause_code=cause_code.value,
            cause_confidence=round(rng.uniform(0.6, 0.98), 3),
            attempt_number=1,
            hour_of_day=event_time.hour,
            day_of_month=event_time.day,
            days_to_inferred_salary_day=_days_to_salary_day(event_time, customer.salary_day_of_month),
            is_weekend=event_time.weekday() >= 5,
            days_since_event_detected=0,
            payment_method=payment_method,
            issuer=rng.choice(_ISSUERS).value,
            gateway=rng.choice(_GATEWAYS).value,
            gateway_success_rate_1h=round(rng.uniform(0.85, 0.99), 3),
            cart_category=cart_category,
            delivery_fee_ratio=delivery_fee_ratio,
            device=device,
            checkout_stage_at_abandon=checkout_stage,
        )

        rows.append(WarmupRow(features=to_feature_row(inputs), action=p["action"], resolved=p["resolved"], opted_out=p["opted_out"]))

    frame = pd.DataFrame([r.features for r in rows])
    frame["action"] = [r.action.value for r in rows]
    frame["resolved"] = [r.resolved for r in rows]
    frame["opted_out"] = [r.opted_out for r in rows]
    return frame
