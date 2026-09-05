"""
The decision engine (section 4.2, 4.3, 4.6) — "everything else in this
project is scaffolding around this section." Pure arithmetic on calibrated
probabilities; the LLM is never in this file (4.4: "the LLM does NOT choose
the action").

`policy_filter` is injectable, defaulting to the real guardrail engine
(`app/agent/policy.py`, stage 6) — its contract (a callable taking
`candidate_actions, *, event, customer, sim_time, policies` and returning an
object with `.allowed`/`.blocked`) was pinned by `tests/test_guardrails.py`
back in stage 3, before that engine existed; this is the module those tests
were written to make possible.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from sqlmodel import Session

from app.agent.costs import ACTION_DIRECT_COST_PAISE
from app.agent.policy import contact_counts
from app.agent.policy import policy_filter as _real_policy_filter
from app.config import settings
from app.ml.predict import PredictionCI
from app.models.customers import Customer
from app.models.decisions import Decision, DecisionCandidate
from app.models.enums import Action, CauseCode, Channel, DecidedBy, FarmingTier, ReasonCode
from app.models.policies import Policy
from app.models.risk_events import RiskEvent

ALL_ACTIONS = list(Action)
NON_HOLD_ACTIONS = [a for a in ALL_ACTIONS if a != Action.HOLD]
_MESSAGE_ACTIONS = (Action.NUDGE_FREE, Action.NUDGE_INCENTIVE, Action.ESCALATE_HUMAN)  # 4.2: annoyance only for actions that reach the customer
_NEVER_RETRY_CODES = {CauseCode.EXPIRED_CARD, CauseCode.MANDATE_REVOKED}  # 4.6 — checked here too, defense in depth ahead of stage 6's guardrail

# 4.6: "Search over {0%, 5%, 8%, 12%} and take the smallest with EV > tau."
_INCENTIVE_SEARCH_BPS = [0, 500, 800, 1200]
# Model B's NUDGE_INCENTIVE arm has no incentive_bps input feature (7.4 never
# lists one — the model estimates recovery under "some incentive", not a
# specific size). To give 4.6's search real teeth without inventing a number
# the model never saw, we treat the model's raw uplift estimate as the effect
# of a *reference* 1000bps (10%) incentive and scale linearly below that,
# capped at 1x above it. This implementation's own transparent assumption,
# not a trained relationship — documented rather than hidden, same as
# farming.py's discipline for "explain it in ten seconds on stage."
_INCENTIVE_REFERENCE_BPS = 1000


def _incentive_uplift_scale(bps: int) -> float:
    return min(bps / _INCENTIVE_REFERENCE_BPS, 1.0)


# Second-stage retry timing per cause (4.6) — everything not explicitly
# listed falls back to a conservative +24h (this implementation's own
# calibration; 4.6 only names four of the nine causes explicitly).
_RETRY_DELAY_HOURS_BY_CAUSE = {
    CauseCode.BANK_DOWNTIME: settings.bank_downtime_retry_delay_hours,
    CauseCode.ISSUER_DECLINED: settings.issuer_declined_retry_delay_hours,
    CauseCode.DO_NOT_HONOUR: settings.issuer_declined_retry_delay_hours,
}
_DEFAULT_RETRY_DELAY_HOURS = 24


@dataclass
class _Candidate:
    action: Action
    p_recover: float
    uplift: float
    gross_gain_paise: float
    direct_cost_paise: float
    incentive_cost_paise: float
    annoyance_cost_paise: float
    farming_cost_paise: float
    ev_paise: float
    ci_low_paise: float
    ci_high_paise: float
    incentive_bps: int = 0
    allowed: bool = True
    block_reason: str | None = None
    policy_id: str | None = None


def _retry_timing(cause_code: CauseCode | None, now: datetime, inferred_salary_day: int | None) -> datetime:
    if cause_code == CauseCode.INSUFFICIENT_FUNDS and inferred_salary_day is not None:
        days_in_month = 28
        days_ahead = (inferred_salary_day - now.day) % days_in_month
        days_ahead = min(days_ahead, settings.retry_scheduled_max_days)
        return now + timedelta(days=max(days_ahead, 1))
    delay_hours = _RETRY_DELAY_HOURS_BY_CAUSE.get(cause_code, _DEFAULT_RETRY_DELAY_HOURS)
    return now + timedelta(hours=delay_hours)


def _choose_channel(customer: Customer) -> Channel:
    # 4.6: "WhatsApp if opted in and phone verified, else email. Never both."
    # Our schema has no separate phone-verification flag — whatsapp_opted_in
    # is the closest available signal, used as-is.
    return Channel.WHATSAPP if customer.whatsapp_opted_in else Channel.EMAIL


def _build_candidate(
    action: Action,
    p_baseline: PredictionCI,
    scores: dict[str, PredictionCI],
    value_at_risk: int,
    margin_rate: float,
    ltv_expected: int,
    farming_score: float,
    inferred_salary_day: int | None,
    max_incentive_bps: int | None = None,
) -> _Candidate:
    if action == Action.HOLD:
        return _Candidate(Action.HOLD, p_baseline.p_mean, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    p = scores[action.value]
    direct_cost = ACTION_DIRECT_COST_PAISE[action]

    if action == Action.NUDGE_INCENTIVE:
        raw_uplift = p.p_mean - p_baseline.p_mean
        raw_uplift_low = p.ci_low - p_baseline.ci_high
        raw_uplift_high = p.ci_high - p_baseline.ci_low
        best_candidate = None
        # 9.3 policy #9: "watch"-tier farmers cap the search space itself,
        # not just the eventual choice — the search never even considers a
        # bps size the policy would block.
        search_space = [b for b in _INCENTIVE_SEARCH_BPS if max_incentive_bps is None or b <= max_incentive_bps]
        for bps in search_space:
            scale = _incentive_uplift_scale(bps)
            uplift, uplift_low, uplift_high = raw_uplift * scale, raw_uplift_low * scale, raw_uplift_high * scale
            gross_gain = uplift * value_at_risk * margin_rate
            incentive_cost = (bps / 10_000) * value_at_risk
            annoyance_cost = scores["p_optout"].p_mean * ltv_expected * margin_rate
            farming_cost = farming_score * incentive_cost  # 4.2: farming_cost(a) = farming_score x expected_future_leakage(a); leakage approximated as the incentive itself, since that's exactly what trains farmer behaviour (6.2)
            ev = gross_gain - direct_cost - incentive_cost - annoyance_cost - farming_cost
            candidate = _Candidate(
                action, p_baseline.p_mean + uplift, uplift, gross_gain, direct_cost, incentive_cost, annoyance_cost, farming_cost, ev,
                uplift_low * value_at_risk * margin_rate - direct_cost - incentive_cost - annoyance_cost - farming_cost,
                uplift_high * value_at_risk * margin_rate - direct_cost - incentive_cost - annoyance_cost - farming_cost,
                incentive_bps=bps,
            )
            if best_candidate is None or candidate.ev_paise > best_candidate.ev_paise:
                best_candidate = candidate
            if ev > settings.tau_paise:
                return candidate  # smallest bps (search is ascending) that already clears tau
        return best_candidate

    uplift = p.p_mean - p_baseline.p_mean
    uplift_low = p.ci_low - p_baseline.ci_high
    uplift_high = p.ci_high - p_baseline.ci_low
    gross_gain = uplift * value_at_risk * margin_rate
    annoyance_cost = scores["p_optout"].p_mean * ltv_expected * margin_rate if action in _MESSAGE_ACTIONS else 0.0
    farming_cost = 0.0  # only NUDGE_INCENTIVE trains farmer behaviour (6.2) — no incentive, no leakage
    ev = gross_gain - direct_cost - annoyance_cost - farming_cost
    return _Candidate(
        action, p.p_mean, uplift, gross_gain, direct_cost, 0.0, annoyance_cost, farming_cost, ev,
        uplift_low * value_at_risk * margin_rate - direct_cost - annoyance_cost - farming_cost,
        uplift_high * value_at_risk * margin_rate - direct_cost - annoyance_cost - farming_cost,
    )


def _increment_trigger_counts(session: Session, policies: list[Policy], policy_ids: set[str]) -> None:
    changed = False
    for policy in policies:
        if policy.id in policy_ids:
            policy.trigger_count += 1
            session.add(policy)
            changed = True
    if changed:
        session.commit()


def decide(
    session: Session,
    risk_event: RiskEvent,
    customer: Customer,
    scores: dict[str, PredictionCI],
    now: datetime,
    inferred_salary_day: int | None = None,
    policy_filter=_real_policy_filter,
    policies: list[Policy] | None = None,
) -> Decision:
    margin_rate = risk_event.margin_rate_bps / 10_000
    value_at_risk = risk_event.value_at_risk_paise
    p_baseline = scores["p_baseline"]
    policies = policies or []

    # 9.3 policy #9 ("half incentive to watch farmers") caps the *search
    # space* for a parameter, which policy_filter (an action-level filter)
    # structurally can't express — enforced directly here instead.
    max_incentive_bps = settings.watch_tier_max_incentive_bps if customer.farming_tier == FarmingTier.WATCH else None
    candidates = {
        a: _build_candidate(a, p_baseline, scores, value_at_risk, margin_rate, customer.ltv_expected_paise, float(customer.farming_score), inferred_salary_day, max_incentive_bps)
        for a in ALL_ACTIONS
    }
    if max_incentive_bps is not None:
        watch_policy = next((p for p in policies if p.name == "Half incentive to watch farmers"), None)
        if watch_policy is not None:
            _increment_trigger_counts(session, policies, {watch_policy.id})

    # Defense in depth ahead of the guardrail engine (9.3, policy #6): never
    # let a dead-mandate retry win on arithmetic alone, even if a policy row
    # were disabled or missing.
    if risk_event.cause_code in _NEVER_RETRY_CODES:
        for a in (Action.RETRY_NOW, Action.RETRY_SCHEDULED):
            candidates[a].ev_paise = -1  # effectively removes it from contention without deleting the row

    extra_context = contact_counts(session, risk_event, customer, now)
    filter_result = policy_filter(NON_HOLD_ACTIONS, event=risk_event, customer=customer, sim_time=now, policies=policies, extra_context=extra_context)
    allowed_set = set(filter_result.allowed) | {Action.HOLD}
    blocked_lookup = {b.action: b for b in filter_result.blocked}
    _increment_trigger_counts(session, policies, {b.policy_id for b in filter_result.blocked})
    for action, candidate in candidates.items():
        candidate.allowed = action in allowed_set
        if action in blocked_lookup:
            candidate.block_reason = blocked_lookup[action].policy_name
            candidate.policy_id = blocked_lookup[action].policy_id

    allowed_candidates = [c for c in candidates.values() if c.allowed]
    best = max(allowed_candidates, key=lambda c: c.ev_paise)

    final_action = best.action
    if best.ev_paise <= 0:
        final_action = Action.HOLD
        reason_code = ReasonCode.POLICY_BLOCKED if filter_result.blocked else ReasonCode.NO_ACTION_BEATS_HOLD
    elif best.ci_low_paise <= 0:
        if value_at_risk >= settings.ambiguity_escalation_threshold_paise and Action.ESCALATE_HUMAN in allowed_set:
            final_action = Action.ESCALATE_HUMAN
            reason_code = ReasonCode.HIGH_VALUE_AMBIGUOUS
        else:
            final_action = Action.HOLD
            reason_code = ReasonCode.UNCERTAIN_UPLIFT
    elif best.ev_paise < settings.tau_paise:
        final_action = Action.HOLD
        reason_code = ReasonCode.EDGE_TOO_THIN
    else:
        reason_code = ReasonCode.POSITIVE_EV

    chosen_params: dict = {}
    if final_action == Action.RETRY_SCHEDULED:
        chosen_params["scheduled_for_sim"] = _retry_timing(risk_event.cause_code, now, inferred_salary_day).isoformat()
    if final_action in (Action.NUDGE_FREE, Action.NUDGE_INCENTIVE):
        chosen_params["channel"] = _choose_channel(customer).value
        chosen_params["language"] = customer.preferred_language.value
    if final_action == Action.NUDGE_INCENTIVE:
        chosen_params["incentive_bps"] = candidates[Action.NUDGE_INCENTIVE].incentive_bps

    hold_margin_protected = None
    if final_action == Action.HOLD:
        hold_margin_protected = round(best.direct_cost_paise + best.incentive_cost_paise + best.annoyance_cost_paise + best.farming_cost_paise)

    blocked_actions_json = [{"action": a.value, "policy_id": b.policy_id, "policy_name": b.policy_name} for a, b in blocked_lookup.items()]

    decision = Decision(
        risk_event_id=risk_event.id,
        chosen_action=final_action,
        chosen_params=chosen_params,
        reason_code=reason_code,
        p_baseline=Decimal(str(round(p_baseline.p_mean, 4))),
        best_ev_paise=round(best.ev_paise),
        best_ev_ci_low_paise=round(best.ci_low_paise),
        best_ev_ci_high_paise=round(best.ci_high_paise),
        hold_margin_protected_paise=hold_margin_protected,
        blocked_actions=blocked_actions_json,
        decided_by=DecidedBy.ENGINE,
        latency_ms=0,
        decided_at_sim=now,
    )
    session.add(decision)
    session.commit()
    session.refresh(decision)

    ranked = sorted(candidates.values(), key=lambda c: -c.ev_paise)
    for rank, c in enumerate(ranked, start=1):
        session.add(
            DecisionCandidate(
                decision_id=decision.id,
                action=c.action,
                p_recover=Decimal(str(round(c.p_recover, 4))),
                uplift=Decimal(str(round(c.uplift, 4))),
                gross_gain_paise=round(c.gross_gain_paise),
                direct_cost_paise=round(c.direct_cost_paise),
                incentive_cost_paise=round(c.incentive_cost_paise),
                annoyance_cost_paise=round(c.annoyance_cost_paise),
                farming_cost_paise=round(c.farming_cost_paise),
                ev_paise=round(c.ev_paise),
                ci_low_paise=round(c.ci_low_paise),
                ci_high_paise=round(c.ci_high_paise),
                allowed=c.allowed,
                block_reason=c.block_reason,
                rank=rank,
            )
        )
    session.commit()
    return decision
