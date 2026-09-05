"""
The ~30-feature list (section 7.4), as a pure function over already-known
values — no DB/session dependency, so both the offline warm-up generator
(bootstrap_data.py, stage 4) and the live agent's score.py (stage 5) build
feature rows through the same path. Field names are copied verbatim from
7.4's three lists (customer / event / context); 33 named fields total, which
is what the spec's own "~30 features" means literally.
"""

from dataclasses import dataclass, fields


@dataclass(frozen=True)
class FeatureInputs:
    # --- customer (7.4) -------------------------------------------------------
    tenure_days: int
    segment: str
    ltv_expected: int  # paise
    gross_margin_bps: int
    prior_recovery_count: int
    prior_abandon_count: int
    abandon_rate_90d: float
    farming_score: float
    days_since_last_purchase: int
    messages_received_7d: int
    messages_received_30d: int
    prior_optout_signals: int
    preferred_language: str
    whatsapp_opted_in: bool

    # --- event (7.4) -----------------------------------------------------------
    kind: str
    value_at_risk: int  # paise
    value_percentile_for_customer: float
    cause_code: str
    cause_confidence: float
    attempt_number: int
    hour_of_day: int
    day_of_month: int
    days_to_inferred_salary_day: float | None
    is_weekend: bool
    days_since_event_detected: int

    # --- context (7.4) ----------------------------------------------------------
    payment_method: str
    issuer: str
    gateway: str
    gateway_success_rate_1h: float
    cart_category: str
    delivery_fee_ratio: float
    device: str
    checkout_stage_at_abandon: str


FEATURE_NAMES: list[str] = [f.name for f in fields(FeatureInputs)]

# Everything not in this set is treated as numeric by the training pipeline
# (train.py's ColumnTransformer) — booleans convert to 0/1 there.
CATEGORICAL_FEATURES: list[str] = [
    "segment",
    "preferred_language",
    "kind",
    "cause_code",
    "payment_method",
    "issuer",
    "gateway",
    "cart_category",
    "device",
    "checkout_stage_at_abandon",
]
NUMERIC_FEATURES: list[str] = [name for name in FEATURE_NAMES if name not in CATEGORICAL_FEATURES]

_MISSING_CATEGORY = "n/a"  # e.g. cart_category on a renewal event — the checkout-only fields don't apply


def to_feature_row(inputs: FeatureInputs) -> dict[str, float | int | str]:
    """Flattens to a dict keyed by FEATURE_NAMES, ready for a pandas DataFrame row."""
    row: dict[str, float | int | str] = {}
    for f in fields(inputs):
        value = getattr(inputs, f.name)
        if f.name in CATEGORICAL_FEATURES:
            row[f.name] = value if value is not None else _MISSING_CATEGORY
        elif isinstance(value, bool):
            row[f.name] = int(value)
        elif value is None:
            row[f.name] = float("nan")
        else:
            row[f.name] = value
    return row
