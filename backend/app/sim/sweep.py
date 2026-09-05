"""
The world's own heartbeat (section 3's architecture diagram: "SWEEP: poll
every N sim-minutes") — steps through `sim_days` and generates raw
checkout/renewal activity for the population. Distinct from
`agent/detect.py` (stage 5), which will later *read* these same raw tables
to create `risk_events` — sim/sweep.py only ever writes the commercial
events a real company's systems would have logged; it has no concept of a
risk event, a decision, or an agent.

CALIBRATION NOTE: `CHECKOUT_DAILY_PROBABILITY` has no spec-given value — the
spec fixes cause-code shares and self-recovery rates (6.3) but never an
attempt frequency. Chosen so a default 2,000-customer/30-day run lands in
the same order of magnitude as 8.4's illustrative `events_total: 1180`
example, without trying to hit that number exactly (11.2's "do not fudge the
numbers" applies here as much as anywhere else in this project).
"""

import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.models.billing import CheckoutSession, PaymentAttempt

from .events import GeneratedEvent, generate_checkout_event, generate_renewal_event
from .population import SimCustomer
from .world_params import WorldParams

CHECKOUT_DAILY_PROBABILITY = 0.03


@dataclass
class SweepResult:
    checkouts: list[CheckoutSession] = field(default_factory=list)
    payment_attempts: list[PaymentAttempt] = field(default_factory=list)
    events: list[GeneratedEvent] = field(default_factory=list)


def run_sweep(population: list[SimCustomer], sim_start: datetime, sim_days: int, params: WorldParams, rng: random.Random) -> SweepResult:
    result = SweepResult()

    for day in range(sim_days):
        day_start = sim_start + timedelta(days=day)

        for sim_customer in population:
            if rng.random() < CHECKOUT_DAILY_PROBABILITY:
                event_time = day_start + timedelta(hours=rng.uniform(6, 22))  # waking hours
                checkout, attempts, gen_event = generate_checkout_event(sim_customer, event_time, params, rng)
                result.checkouts.append(checkout)
                result.payment_attempts.extend(attempts)
                result.events.append(gen_event)

            if sim_customer.has_subscription and day_start.day == sim_customer.subscription.billing_day:
                event_time = day_start + timedelta(hours=rng.uniform(0, 6))
                attempts, gen_event = generate_renewal_event(sim_customer, event_time, params, rng)
                result.payment_attempts.extend(attempts)
                if gen_event is not None:
                    result.events.append(gen_event)

    return result
