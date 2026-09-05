"""Policies — the guardrail engine's editable surface (section 9.2/9.3, 8.4)."""

from typing import Any

from pydantic import BaseModel

from app.models.enums import Action, PolicyAuthoredBy, PolicyKind


class Policy(BaseModel):
    id: str
    name: str
    kind: PolicyKind
    rule: Any
    applies_to: list[Action]
    enabled: bool
    authored_by: PolicyAuthoredBy
    trigger_count: int


class PolicyUpdateRequest(BaseModel):
    enabled: bool | None = None
    rule: Any = None


class PolicyCreateRequest(BaseModel):
    name: str
    kind: PolicyKind
    applies_to: list[Action]
    rule: Any


class PolicyProposeRequest(BaseModel):
    text: str


class PolicyProposal(BaseModel):
    name: str
    kind: PolicyKind
    applies_to: list[Action]
    rule: Any
    reasoning: str


class PolicySimulateRequest(BaseModel):
    run_id: str
    policies: list[str]


class PolicySimulateResponse(BaseModel):
    blocked_count: int
    net_profit_delta_paise: int
