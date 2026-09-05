"""Audit trail (section 9.6, 8.4)."""

from typing import Any

from pydantic import BaseModel

from app.models.enums import AuditActor, AuditStage


class AuditEntry(BaseModel):
    id: str
    run_id: str
    risk_event_id: str | None
    customer_id: str | None
    stage: AuditStage
    summary: str
    detail: Any
    actor: AuditActor
    sim_time: str
    wall_time: str
    prev_hash: str
    hash: str


class AuditListResponse(BaseModel):
    items: list[AuditEntry]
    next_cursor: str | None


class AuditVerifyResponse(BaseModel):
    intact: bool
    entries_checked: int
    broken_at_entry: int | None
