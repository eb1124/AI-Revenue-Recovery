from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, enum_column, new_id
from .enums import AuditActor, AuditStage


class AuditEntry(TimestampMixin, SQLModel, table=True):
    """Append-only. Never updated, never deleted (section 5.4) — hash-chained, see app/audit.py (stage 6)."""

    __tablename__ = "audit_entries"
    __table_args__ = (Index("ix_audit_entries_run_sim_time", "run_id", "sim_time"),)

    # 5.4 gives no explicit prefix for this table's id; "aud" extends the
    # same by-type-prefix convention (section 5.2).
    id: str = Field(default_factory=lambda: new_id("aud"), primary_key=True)
    run_id: str = Field(foreign_key="runs.id", index=True)
    risk_event_id: str | None = Field(default=None, foreign_key="risk_events.id")
    customer_id: str | None = Field(default=None, foreign_key="customers.id")

    stage: AuditStage = Field(sa_column=enum_column(AuditStage))
    summary: str  # one line, plain English
    detail: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))
    actor: AuditActor = Field(sa_column=enum_column(AuditActor))

    sim_time: datetime
    wall_time: datetime

    prev_hash: str  # SHA-256 of previous entry
    hash: str  # SHA-256 of this entry + prev_hash
