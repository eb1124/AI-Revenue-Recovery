"""
SSE stream (section 8.5) — `GET /api/runs/{run_id}/stream`. Polls the DB for
rows created since the last cycle and translates them into the named events
the frontend expects; the agent loop writes straight to the DB, not to a
queue, so polling (not a true event-driven push) is what actually happens
here. At this data scale (a poll every ~300ms against ULID-indexed columns)
it reads as real-time; a higher-concurrency deployment would want to swap
this for a real pub/sub, which is a known, explicit scope cut, not an
oversight.
"""

import asyncio
import json

from fastapi import APIRouter
from sqlmodel import Session, select
from sse_starlette.sse import EventSourceResponse

from app.agent.run_registry import get_progress, get_speed
from app.api._metrics_compute import compute_run_metrics
from app.db import engine
from app.models.actions import ActionRecord, Message
from app.models.customers import Customer
from app.models.decisions import Decision
from app.models.enums import Action, Arm, RunStatus
from app.models.outcomes import Outcome
from app.models.risk_events import RiskEvent
from app.models.runs import Run

router = APIRouter(prefix="/api/runs", tags=["stream"])

POLL_SECONDS = 0.3  # ~3.3 emissions/sec per event type — under 8.5's "throttle metrics.tick to 4/second maximum"


def _event(name: str, data: dict) -> dict:
    return {"event": name, "data": json.dumps(data)}


def _arm_tick(session: Session, run_id: str, arm: Arm) -> dict:
    event_ids = select(RiskEvent.id).where(RiskEvent.run_id == run_id, RiskEvent.arm == arm)
    outcomes = session.exec(select(Outcome).where(Outcome.risk_event_id.in_(event_ids))).all()
    decisions = session.exec(select(Decision).where(Decision.risk_event_id.in_(event_ids))).all()
    holds = [d for d in decisions if d.chosen_action == Action.HOLD]
    return {
        "net_profit_paise": sum(o.net_profit_paise for o in outcomes),
        "margin_protected_paise": sum(d.hold_margin_protected_paise or 0 for d in holds),
        "holds": len(holds),
    }


async def _stream(run_id: str):
    last_event_id = last_decision_id = last_action_id = last_outcome_id = ""
    last_tier_by_customer: dict[str, str] = {}
    completed_emitted = False

    while True:
        with Session(engine) as session:
            run = session.get(Run, run_id)
            if run is None:
                return  # run was deleted — end the stream

            progress = get_progress(run_id) or {"sim_day": 0, "total_days": run.sim_days, "events_processed": 0, "events_total": 0}
            yield _event("run.progress", {**progress, "speed": get_speed(run_id)})

            new_events = session.exec(select(RiskEvent).where(RiskEvent.run_id == run_id, RiskEvent.id > last_event_id).order_by(RiskEvent.id)).all()
            for e in new_events:
                customer = session.get(Customer, e.customer_id)
                yield _event(
                    "case.detected",
                    {
                        "id": e.id,
                        "customer": {"id": customer.id, "display_name": customer.display_name, "segment": customer.segment.value, "farming_tier": customer.farming_tier.value, "city": customer.city},
                        "kind": e.kind.value,
                        "value_at_risk_paise": e.value_at_risk_paise,
                        "arm": e.arm.value,
                    },
                )
                prior_tier = last_tier_by_customer.get(customer.id)
                if prior_tier is not None and prior_tier != customer.farming_tier.value:
                    yield _event(
                        "farming.escalated",
                        {"customer_id": customer.id, "display_name": customer.display_name, "from_tier": prior_tier, "to_tier": customer.farming_tier.value, "score": float(customer.farming_score)},
                    )
                last_tier_by_customer[customer.id] = customer.farming_tier.value
                last_event_id = e.id

            event_ids_for_run = select(RiskEvent.id).where(RiskEvent.run_id == run_id)
            new_decisions = session.exec(select(Decision).where(Decision.risk_event_id.in_(event_ids_for_run), Decision.id > last_decision_id).order_by(Decision.id)).all()
            for d in new_decisions:
                yield _event(
                    "case.decided",
                    {"id": d.risk_event_id, "action": d.chosen_action.value, "reason_code": d.reason_code.value, "margin_protected_paise": d.hold_margin_protected_paise, "best_ev_paise": d.best_ev_paise},
                )
                for b in d.blocked_actions:
                    yield _event("guardrail.blocked", {"id": d.risk_event_id, "action": b["action"], "policy_id": b["policy_id"], "policy_name": b["policy_name"]})
                last_decision_id = d.id

            new_actions = session.exec(select(ActionRecord).where(ActionRecord.risk_event_id.in_(event_ids_for_run), ActionRecord.id > last_action_id).order_by(ActionRecord.id)).all()
            for a in new_actions:
                message = session.exec(select(Message).where(Message.action_id == a.id)).first()
                yield _event("case.acted", {"id": a.risk_event_id, "action_id": a.id, "type": a.type.value, "channel": message.channel.value if message else None, "cost_paise": a.cost_paise})
                last_action_id = a.id

            new_outcomes = session.exec(select(Outcome).where(Outcome.risk_event_id.in_(event_ids_for_run), Outcome.id > last_outcome_id).order_by(Outcome.id)).all()
            for o in new_outcomes:
                yield _event("case.outcome", {"id": o.risk_event_id, "resolution_path": o.resolution_path.value, "net_profit_paise": o.net_profit_paise, "incremental_profit_paise": o.incremental_profit_paise})
                last_outcome_id = o.id

            if new_events or new_decisions or new_actions or new_outcomes:
                yield _event("metrics.tick", {"agent": _arm_tick(session, run_id, Arm.AGENT), "baseline": _arm_tick(session, run_id, Arm.BASELINE)})

            if run.status == RunStatus.COMPLETED and not completed_emitted:
                summary = compute_run_metrics(session, run)
                yield _event("run.completed", {"run_id": run.id, "summary": json.loads(summary.model_dump_json())})
                completed_emitted = True
                return

        await asyncio.sleep(POLL_SECONDS)


@router.get("/{run_id}/stream")
async def stream_run(run_id: str) -> EventSourceResponse:
    return EventSourceResponse(_stream(run_id))
