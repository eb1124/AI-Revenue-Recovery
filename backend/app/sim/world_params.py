"""
The adversarial knobs (section 6.5) — the judge panel. Field names, defaults
and ranges are copied verbatim from the 6.5 table, and mirror
frontend/src/api/schemas.ts's WorldParamsSchema exactly (that file is the
authoritative frontend/backend contract per the task brief).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class WorldParams:
    salary_timing_lift: float = 2.4  # 1.0 - 4.0  — "Your retry-timing edge is fabricated"
    self_recovery_base: float = 0.30  # 0.05 - 0.70  — "Nobody comes back on their own"
    incentive_elasticity: float = 1.6  # 1.0 - 3.0  — "Discounts work better than you assume"
    farmer_share: float = 0.15  # 0.00 - 0.40  — "Farming isn't real"
    farmer_learning_rate: float = 0.12  # 0.0 - 0.5  — "Customers don't adapt that fast"
    message_fatigue: float = 0.40  # 0.0 - 1.0  — "Spamming is free"
    margin_rate_bps: int = 2200  # 500 - 6000  — "Your margins are unrealistic"
    optout_sensitivity: float = 1.0  # 0.0 - 3.0  — "Annoyance costs nothing"
    population_size: int = 2000  # 200 - 20000
    sim_days: int = 30  # 7 - 90
    seed: int = 42


DEFAULT_WORLD_PARAMS = WorldParams()
