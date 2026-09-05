"""Policies — the guardrail engine's editable surface (section 9.2/9.3, 8.4)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.agent.policy import contact_counts, policy_filter
from app.db import get_session
from app.llm.propose import propose_policy
from app.models.customers import Customer
from app.models.decisions import Decision
from app.models.enums import Action, PolicyAuthoredBy
from app.models.outcomes import Outcome
from app.models.policies import Policy as PolicyModel
from app.models.risk_events import RiskEvent
from app.schemas.policies import (
    Policy,
    PolicyCreateRequest,
    PolicyProposal,
    PolicyProposeRequest,
    PolicySimulateRequest,
    PolicySimulateResponse,
    PolicyUpdateRequest,
)

router = APIRouter(prefix="/api/policies", tags=["policies"])


def _to_schema(policy: PolicyModel) -> Policy:
    return Policy(
        id=policy.id, name=policy.name, kind=policy.kind, rule=policy.rule, applies_to=[Action(a) for a in policy.applies_to],
        enabled=policy.enabled, authored_by=policy.authored_by, trigger_count=policy.trigger_count,
    )


@router.get("", response_model=list[Policy])
def list_policies(session: Session = Depends(get_session)) -> list[Policy]:
    return [_to_schema(p) for p in session.exec(select(PolicyModel)).all()]


@router.post("", status_code=201, response_model=Policy)
def create_policy(body: PolicyCreateRequest, session: Session = Depends(get_session)) -> Policy:
    policy = PolicyModel(name=body.name, kind=body.kind, applies_to=[a.value for a in body.applies_to], rule=body.rule, enabled=True, authored_by=PolicyAuthoredBy.LLM_PROPOSAL)
    session.add(policy)
    session.commit()
    session.refresh(policy)
    return _to_schema(policy)


@router.put("/{policy_id}", response_model=Policy)
def update_policy(policy_id: str, body: PolicyUpdateRequest, session: Session = Depends(get_session)) -> Policy:
    policy = session.get(PolicyModel, policy_id)
    if policy is None:
        raise HTTPException(404, "policy not found")
    if body.enabled is not None:
        policy.enabled = body.enabled
    if body.rule is not None:
        policy.rule = body.rule
    session.add(policy)
    session.commit()
    session.refresh(policy)
    return _to_schema(policy)


@router.post("/propose", response_model=PolicyProposal)
def propose(body: PolicyProposeRequest) -> PolicyProposal:
    result = propose_policy(body.text)
    return PolicyProposal(name=result.name, kind=result.kind, applies_to=result.applies_to, rule=result.rule, reasoning=result.reasoning)


@router.post("/simulate", response_model=PolicySimulateResponse)
def simulate(body: PolicySimulateRequest, session: Session = Depends(get_session)) -> PolicySimulateResponse:
    """
    A real what-if, not an invented number: re-runs the actual policy engine
    (app/agent/policy.py) against this run's own terminal cases with only the
    named policies enabled, and reports how many chosen actions would have
    been blocked plus the net_profit this run would have foregone on those
    specific cases (their own recorded incremental_profit_paise).
    """
    policies_to_test = session.exec(select(PolicyModel).where(PolicyModel.id.in_(body.policies))).all()
    events = session.exec(select(RiskEvent).where(RiskEvent.run_id == body.run_id, RiskEvent.id.in_(select(Outcome.risk_event_id)))).all()

    blocked_count = 0
    net_profit_delta_paise = 0
    for event in events:
        decision = session.exec(select(Decision).where(Decision.risk_event_id == event.id)).first()
        outcome = session.exec(select(Outcome).where(Outcome.risk_event_id == event.id)).first()
        if decision is None or outcome is None or decision.chosen_action == Action.HOLD:
            continue
        customer = session.get(Customer, event.customer_id)
        counts = contact_counts(session, event, customer, decision.decided_at_sim)
        result = policy_filter([decision.chosen_action], event=event, customer=customer, sim_time=decision.decided_at_sim, policies=policies_to_test, extra_context=counts)
        if decision.chosen_action not in result.allowed:
            blocked_count += 1
            net_profit_delta_paise -= outcome.incremental_profit_paise

    return PolicySimulateResponse(blocked_count=blocked_count, net_profit_delta_paise=net_profit_delta_paise)
