"""
The response oracle (section 6.4) — ground truth the agent never sees.

Stage 2 only exercises the no-agent path: what happens if nobody
intervenes (implicit HOLD), which is what naturally resolves raw
checkout/payment rows while no agent exists yet (stages 5+). The full
`p_true_recover(e, a)` formula also has terms for channel/incentive/fatigue
that only mean something once an agent can actually take those actions —
those are wired here with neutral (no-op) defaults so stage 5 extends this
function rather than rewriting it.

CALIBRATION NOTE: 6.3 gives exact per-cause self-recovery rates, but the
archetype multipliers and the salary-timing boost below have no numeric
spec — the spec only describes them qualitatively ("intervening on these is
pure margin destruction" / "real friction"). The values chosen here are this
implementation's own calibration, documented inline, not spec-given numbers.
"""

import random
from dataclasses import dataclass
from datetime import datetime

from app.models.enums import Action, CauseCode

from .decline_codes import DECLINE_CODES
from .population import Archetype, SimCustomer
from .world_params import WorldParams

# Self_recoverers actively return; genuinely-stuck customers have real
# friction that doing nothing doesn't fix; price-sensitive customers
# specifically need an incentive to convert; farmers "start as a
# self-recoverer" (6.2) so they share that multiplier until an agent exists
# to make them adapt (stage 5).
_ARCHETYPE_SELF_RECOVERY_MULTIPLIER = {
    Archetype.SELF_RECOVERER: 1.6,
    Archetype.GENUINELY_STUCK: 0.4,
    Archetype.PRICE_SENSITIVE: 0.5,
    Archetype.FARMER: 1.5,
}

_CLAMP_LOW, _CLAMP_HIGH = 0.001, 0.98  # 6.4's oracle clamp bounds


def _salary_timing_multiplier(cause_code: CauseCode, salary_day_of_month: int, event_time: datetime, params: WorldParams) -> float:
    """
    `insufficient_funds` is the "timing is everything" code (6.3) — a
    customer who fails right around their salary day is far likelier to
    self-recover once funds land. At `salary_timing_lift == 1.0` this
    contributes exactly 1.0x (no edge at all) — moving the slider up is what
    "proves" the edge isn't fabricated (6.5's framing for this knob).
    """
    if cause_code != CauseCode.INSUFFICIENT_FUNDS:
        return 1.0
    days_in_month = 28
    delta = min((event_time.day - salary_day_of_month) % days_in_month, (salary_day_of_month - event_time.day) % days_in_month)
    proximity = max(0.0, 1.0 - delta / 7.0)  # within a week of salary day
    return 1.0 + (params.salary_timing_lift - 1.0) * proximity


def p_self_recovery(cause_code: CauseCode, sim_customer: SimCustomer, event_time: datetime, params: WorldParams) -> float:
    base = DECLINE_CODES[cause_code].self_recovery_rate
    # `self_recovery_base` (default 0.30) scales every per-cause rate
    # proportionally; at the default value this is a no-op (6.5: "Nobody
    # comes back on their own" — crank it down and every code's rate falls).
    base_scaled = base * (params.self_recovery_base / 0.30)

    archetype_mult = _ARCHETYPE_SELF_RECOVERY_MULTIPLIER[sim_customer.archetype]
    timing_mult = _salary_timing_multiplier(cause_code, sim_customer.row.salary_day_of_month, event_time, params)

    p = base_scaled * archetype_mult * timing_mult
    return min(_CLAMP_HIGH, max(_CLAMP_LOW, p))


# --- p_true_recover(e, a) for the five non-HOLD actions (stage 4) -----------
#
# 4.2 defines uplift(a) = p_recover(a) - p_baseline, and p_self_recovery above
# *is* p_baseline (the HOLD case). The cleanest, most spec-faithful way to
# extend the oracle to the other five actions is therefore "p_self_recovery
# plus an action-specific additive uplift" rather than re-deriving 6.4's full
# multiplicative chain term-by-term — the two are equivalent in shape (both
# ultimately produce p_recover(a) - p_baseline) and this one is auditable
# action-by-action. Every uplift table below is this implementation's own
# calibration (no numeric spec given for these terms, same disclaimer as the
# module docstring) — anchored to 6.3's "best action" column and 6.2's
# archetype descriptions so the *ordering* of effects is never invented, only
# the magnitudes.

# Max additional recovery probability a retry can buy, before timing
# adjustments — reading straight off 6.3's "best action" / "notes" columns:
# insufficient_funds and bank_downtime are where retrying is most rewarded
# (timing-sensitive/transient); expired_card and mandate_revoked get exactly
# 0 (dead mandate — 4.6: "never retry"); do_not_honour and risk_declined get
# almost nothing ("retrying rarely helps" / a fraud flag doesn't clear itself).
_RETRY_UPLIFT_BASE = {
    CauseCode.INSUFFICIENT_FUNDS: 0.35,
    CauseCode.ISSUER_DECLINED: 0.20,
    CauseCode.DO_NOT_HONOUR: 0.05,
    CauseCode.EXPIRED_CARD: 0.0,
    CauseCode.MANDATE_REVOKED: 0.0,
    CauseCode.UPI_TIMEOUT: 0.15,
    CauseCode.BANK_DOWNTIME: 0.25,
    CauseCode.RISK_DECLINED: 0.02,
    CauseCode.CARD_LIMIT_EXCEEDED: 0.15,
}


def _retry_uplift(cause_code: CauseCode, action: Action, sim_customer: SimCustomer, event_time: datetime, params: WorldParams) -> float:
    base_uplift = _RETRY_UPLIFT_BASE[cause_code]
    if base_uplift == 0.0:
        return 0.0
    if action == Action.RETRY_NOW:
        # Immediate — doesn't wait for the underlying condition (low funds,
        # an outage) to actually clear, so it only gets half credit.
        return base_uplift * 0.5
    # RETRY_SCHEDULED — timed to the per-cause window (4.6).
    if cause_code == CauseCode.INSUFFICIENT_FUNDS:
        return base_uplift * _salary_timing_multiplier(cause_code, sim_customer.row.salary_day_of_month, event_time, params)
    if cause_code == CauseCode.BANK_DOWNTIME:
        return base_uplift * 1.3  # scheduled +4h (4.6) lands after most downtime windows clear
    return base_uplift


# Max additional recovery probability a message can buy (NUDGE_FREE base
# case), before archetype/fatigue adjustment. expired_card is deliberately
# the highest — it's *exactly* the update-link case 6.3 names. mandate_revoked
# is low — "customer actively cancelled," a message rarely undoes that.
_NUDGE_UPLIFT_BASE = {
    CauseCode.INSUFFICIENT_FUNDS: 0.05,
    CauseCode.ISSUER_DECLINED: 0.08,
    CauseCode.DO_NOT_HONOUR: 0.18,
    CauseCode.EXPIRED_CARD: 0.22,
    CauseCode.MANDATE_REVOKED: 0.03,
    CauseCode.UPI_TIMEOUT: 0.04,
    CauseCode.BANK_DOWNTIME: 0.03,
    CauseCode.RISK_DECLINED: 0.02,
    CauseCode.CARD_LIMIT_EXCEEDED: 0.10,
}

# 6.2: self-recoverers "would have come back anyway" (a nudge adds little);
# genuinely-stuck customers "respond well to the *right* nudge"; price-
# sensitive customers need the incentive itself, not just a message.
_ARCHETYPE_NUDGE_FREE_MULTIPLIER = {
    Archetype.SELF_RECOVERER: 0.6,
    Archetype.GENUINELY_STUCK: 1.3,
    Archetype.PRICE_SENSITIVE: 0.5,
    Archetype.FARMER: 0.9,
}
# 6.2: price-sensitive customers are "genuinely incremental, but expensive"
# under an incentive; farmers "exploit" reliable incentives (real short-term
# conversion, even though it trains bad long-run behaviour — that's
# adapt_farmer_propensity's job, not this function's).
_ARCHETYPE_NUDGE_INCENTIVE_MULTIPLIER = {
    Archetype.SELF_RECOVERER: 0.3,
    Archetype.GENUINELY_STUCK: 0.7,
    Archetype.PRICE_SENSITIVE: 1.8,
    Archetype.FARMER: 1.5,
}


def _fatigue_multiplier(messages_sent_7d: int, params: WorldParams) -> float:
    """
    6.4: "the third message in 7 days is roughly 40% as effective as the
    first." `(1 - message_fatigue) ** n` at the default message_fatigue=0.40
    gives 0.6**2 = 0.36 for the third message (n=2 prior messages) — close to
    that anchor without being force-fit to it exactly (this project's
    running discipline: don't fudge numbers to match illustrative spec copy).
    `message_fatigue == 0` ("spamming is free", 6.5) correctly makes this 1.0
    at any n.
    """
    return (1.0 - params.message_fatigue) ** messages_sent_7d


def _nudge_uplift(cause_code: CauseCode, action: Action, sim_customer: SimCustomer, params: WorldParams, messages_sent_7d: int) -> float:
    base = _NUDGE_UPLIFT_BASE[cause_code]
    fatigue = _fatigue_multiplier(messages_sent_7d, params)
    if action == Action.NUDGE_INCENTIVE:
        # incentive_elasticity's own default (1.6x, 6.5) is baked into the
        # archetype table above, so dividing by it here keeps that default a
        # no-op — moving the slider is what scales the effect up or down.
        archetype_mult = _ARCHETYPE_NUDGE_INCENTIVE_MULTIPLIER[sim_customer.archetype] * (params.incentive_elasticity / 1.6)
    else:
        archetype_mult = _ARCHETYPE_NUDGE_FREE_MULTIPLIER[sim_customer.archetype]
    return base * archetype_mult * fatigue


# risk_declined is exactly the "possible fraud flag" case 6.3 names for
# ESCALATE_HUMAN; every other cause gets a flat, modest "a human can usually
# do a little better than nothing, at high cost" bump.
_ESCALATE_UPLIFT_BASE = {CauseCode.RISK_DECLINED: 0.30}
_ESCALATE_UPLIFT_DEFAULT = 0.10


def p_true_recover(
    cause_code: CauseCode,
    sim_customer: SimCustomer,
    action: Action,
    event_time: datetime,
    params: WorldParams,
    messages_sent_7d: int = 0,
) -> float:
    """The full 6.4 oracle across all six actions — ground truth, the agent never sees it."""
    baseline = p_self_recovery(cause_code, sim_customer, event_time, params)
    if action == Action.HOLD:
        return baseline

    if action in (Action.RETRY_NOW, Action.RETRY_SCHEDULED):
        uplift = _retry_uplift(cause_code, action, sim_customer, event_time, params)
    elif action in (Action.NUDGE_FREE, Action.NUDGE_INCENTIVE):
        uplift = _nudge_uplift(cause_code, action, sim_customer, params, messages_sent_7d)
    elif action == Action.ESCALATE_HUMAN:
        uplift = _ESCALATE_UPLIFT_BASE.get(cause_code, _ESCALATE_UPLIFT_DEFAULT)
    else:
        raise ValueError(f"unhandled action {action!r}")

    return min(_CLAMP_HIGH, max(_CLAMP_LOW, baseline + uplift))


# Base opt-out probability per action, in a single 7-day window with no prior
# contact and average tenure — HOLD and the two silent retries never contact
# the customer at all, so they carry no annoyance risk (4.2: annoyance_cost
# only applies to actions that actually reach the customer).
_BASE_OPTOUT_RATE = {
    Action.HOLD: 0.0,
    Action.RETRY_NOW: 0.0,
    Action.RETRY_SCHEDULED: 0.0,
    Action.NUDGE_FREE: 0.015,
    Action.NUDGE_INCENTIVE: 0.02,  # incentive spam reads marginally pushier than a plain reminder
    Action.ESCALATE_HUMAN: 0.01,
}


def p_optout(action: Action, messages_sent_7d: int, tenure_days: int, params: WorldParams) -> float:
    """
    6.4: "p_optout(a) rises with message frequency and falls with
    relationship tenure." `optout_sensitivity == 0` ("annoyance costs
    nothing", 6.5) correctly zeroes this out entirely, not just the
    frequency term.
    """
    base = _BASE_OPTOUT_RATE[action]
    if base == 0.0 or params.optout_sensitivity <= 0:
        return 0.0
    frequency_mult = 1.0 + messages_sent_7d * 0.5
    tenure_mult = max(0.4, 1.0 - tenure_days / 3650)  # floors at 0.4x — even decade-long customers can still opt out
    return min(0.5, base * params.optout_sensitivity * frequency_mult * tenure_mult)


@dataclass(frozen=True)
class SelfRecoveryOutcome:
    recovered: bool
    delay_hours: float | None  # None if never recovers within the observation window


def resolve_self_recovery(
    cause_code: CauseCode,
    sim_customer: SimCustomer,
    event_time: datetime,
    params: WorldParams,
    rng: random.Random,
    max_wait_hours: float = 96.0,
) -> SelfRecoveryOutcome:
    """The implicit-HOLD path used by stage 2's batch sweep (no agent exists there to compare against)."""
    p = p_self_recovery(cause_code, sim_customer, event_time, params)
    if rng.random() >= p:
        return SelfRecoveryOutcome(recovered=False, delay_hours=None)

    # Self-recoverers return quickly (2-8h per 6.2); other archetypes that
    # still self-recover take longer, on average.
    if sim_customer.archetype in (Archetype.SELF_RECOVERER, Archetype.FARMER):
        delay_hours = rng.uniform(2.0, 8.0)
    else:
        delay_hours = rng.uniform(4.0, max_wait_hours)
    return SelfRecoveryOutcome(recovered=True, delay_hours=min(delay_hours, max_wait_hours))


@dataclass(frozen=True)
class PairedOutcome:
    chosen_recovered: bool
    chosen_delay_hours: float | None
    hold_recovered: bool
    hold_delay_hours: float | None


def resolve_paired_outcome(
    cause_code: CauseCode,
    sim_customer: SimCustomer,
    chosen_action: Action,
    event_time: datetime,
    params: WorldParams,
    rng: random.Random,
    messages_sent_7d: int = 0,
    max_wait_hours: float = 96.0,
) -> PairedOutcome:
    """
    Section 6.4: "use the same random seed for both draws, so the comparison
    is a true paired counterfactual and not two independent coin flips."
    Concretely: draw ONE uniform `r` and compare it against both thresholds
    (`p_hold`, `p_chosen`) — the standard common-random-numbers technique.
    Every uplift table in this module is >= 0, so p_chosen >= p_hold always,
    which means this coupling can only ever make recovery *more* likely under
    a real action than under HOLD for the same draw, never less — exactly
    the comparison stage 5's agent loop needs to compute a true incremental
    effect (`outcomes.incremental_profit_paise`), not sampling noise.
    """
    p_hold = p_self_recovery(cause_code, sim_customer, event_time, params)
    p_chosen = p_true_recover(cause_code, sim_customer, chosen_action, event_time, params, messages_sent_7d)
    r = rng.random()
    hold_recovered = r < p_hold
    chosen_recovered = r < p_chosen

    def _delay(recovered: bool) -> float | None:
        if not recovered:
            return None
        if sim_customer.archetype in (Archetype.SELF_RECOVERER, Archetype.FARMER):
            return min(rng.uniform(2.0, 8.0), max_wait_hours)
        return min(rng.uniform(4.0, max_wait_hours), max_wait_hours)

    return PairedOutcome(
        chosen_recovered=chosen_recovered,
        chosen_delay_hours=_delay(chosen_recovered),
        hold_recovered=hold_recovered,
        hold_delay_hours=_delay(hold_recovered),
    )


def adapt_farmer_propensity(sim_customer: SimCustomer, incentive_extracted: bool, params: WorldParams) -> None:
    """
    "If incentives arrive reliably, abandon rate climbs" (6.2). Stage 2 never
    calls this (no agent exists to send an incentive) — it exists here so
    stage 5's Act stage has a single place to update farmer state rather than
    reaching into population internals.
    """
    if sim_customer.archetype != Archetype.FARMER or not incentive_extracted:
        return
    sim_customer.abandon_propensity = min(1.0, sim_customer.abandon_propensity + params.farmer_learning_rate)
