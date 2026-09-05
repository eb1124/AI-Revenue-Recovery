"""
Watchlist — farming detection (section 4.5, 10.9). No JSON example exists in
8.4 for either endpoint; reconstructed from the 10.9 UI mockup, matching
frontend/src/api/schemas.ts's own reconstruction.

Customers have no `run_id` column (5.4) — each run generates a fresh
population, so "customers in this run" is derived via a distinct join on
risk_events.customer_id rather than a direct FK. A customer with zero risk
events has nothing to show on a farming watchlist anyway.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.agent.farming import compute_farming_score
from app.db import get_session
from app.models.actions import ActionRecord
from app.models.billing import CheckoutSession
from app.models.customers import Customer
from app.models.decisions import Decision
from app.models.enums import Action, ActionStatus, CheckoutStage, FarmingTier
from app.models.outcomes import Outcome
from app.models.risk_events import RiskEvent
from app.schemas.cases import FarmingSignals, RecentEvent
from app.schemas.common import iso_z
from app.schemas.watchlist import WatchlistDetail, WatchlistEntry, WatchlistScorePoint

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])

_INCENTIVE_DIRECT_COST_PAISE = 35  # app/agent/costs.py's ACTION_DIRECT_COST_PAISE[NUDGE_INCENTIVE] — the fixed dispatch fee, not the discount itself


def _to_entry(session: Session, customer: Customer) -> WatchlistEntry:
    checkouts = session.exec(select(CheckoutSession).where(CheckoutSession.customer_id == customer.id)).all()
    abandons = sum(1 for c in checkouts if c.stage == CheckoutStage.ABANDONED)

    incentive_actions = session.exec(
        select(ActionRecord)
        .join(RiskEvent, ActionRecord.risk_event_id == RiskEvent.id)
        .where(RiskEvent.customer_id == customer.id, ActionRecord.type == Action.NUDGE_INCENTIVE, ActionRecord.status == ActionStatus.EXECUTED)
    ).all()

    extracted_paise = 0
    for action in incentive_actions:
        outcome = session.exec(select(Outcome).where(Outcome.risk_event_id == action.risk_event_id)).first()
        if outcome is not None and outcome.resolved:
            extracted_paise += max(action.cost_paise - _INCENTIVE_DIRECT_COST_PAISE, 0)

    return WatchlistEntry(
        customer_id=customer.id,
        display_name=customer.display_name,
        farming_tier=customer.farming_tier,
        farming_score=float(customer.farming_score),
        abandons=abandons,
        checkouts_observed=len(checkouts),
        incentives_sent=len(incentive_actions),
        incentives_extracted_paise=extracted_paise,
    )


@router.get("", response_model=list[WatchlistEntry])
def list_watchlist(run_id: str | None = None, tier: FarmingTier | None = None, session: Session = Depends(get_session)) -> list[WatchlistEntry]:
    if run_id:
        customer_ids = session.exec(select(RiskEvent.customer_id).where(RiskEvent.run_id == run_id).distinct()).all()
        customers = session.exec(select(Customer).where(Customer.id.in_(customer_ids))).all() if customer_ids else []
    else:
        customers = session.exec(select(Customer)).all()

    if tier:
        customers = [c for c in customers if c.farming_tier == tier]
    return [_to_entry(session, c) for c in customers]


@router.get("/{customer_id}", response_model=WatchlistDetail)
def get_watchlist_detail(customer_id: str, session: Session = Depends(get_session)) -> WatchlistDetail:
    customer = session.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(404, "customer not found")

    entry = _to_entry(session, customer)
    events = session.exec(select(RiskEvent).where(RiskEvent.customer_id == customer_id).order_by(RiskEvent.detected_at_sim)).all()

    # Reconstructed, not fabricated: farming.compute_farming_score accepts an
    # as-of timestamp, so re-running it at each of the customer's own past
    # event times gives their real historical trajectory — customers.farming_score
    # only ever stores the *latest* value, with no separate history table.
    score_timeline = [WatchlistScorePoint(at=iso_z(e.detected_at_sim), score=round(compute_farming_score(session, customer_id, e.detected_at_sim).score, 4)) for e in events]

    recent_events = []
    for e in reversed(events[-10:]):
        decision = session.exec(select(Decision).where(Decision.risk_event_id == e.id)).first()
        outcome = session.exec(select(Outcome).where(Outcome.risk_event_id == e.id)).first()
        if decision is None or outcome is None:
            continue
        recent_events.append(RecentEvent(id=e.id, kind=e.kind, action=decision.chosen_action, outcome=outcome.resolution_path, at=iso_z(e.detected_at_sim)))

    latest_signals = compute_farming_score(session, customer_id, events[-1].detected_at_sim).signals if events else {}
    farming_signals = FarmingSignals(
        abandon_rate=latest_signals.get("abandon_rate", 0.0),
        post_incentive_conversion=latest_signals.get("post_incentive_conversion_rate", 0.0),
        incentive_dependency=latest_signals.get("incentive_dependency", 0.0),
        timing_regularity=latest_signals.get("timing_regularity", 0.0),
        stage_consistency=latest_signals.get("stage_consistency", 0.0),
    )

    return WatchlistDetail(**entry.model_dump(), score_timeline=score_timeline, farming_signals=farming_signals, events=recent_events)
