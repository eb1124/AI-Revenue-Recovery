from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, Column, Index, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, enum_column, new_id
from .enums import Arm, CauseCode, RiskEventKind, RiskEventStatus


class RiskEvent(TimestampMixin, SQLModel, table=True):
    """The join point (section 5.3) — every downstream table hangs off this one."""

    __tablename__ = "risk_events"
    __table_args__ = (
        # 5.5: the two indexes risk_events needs.
        Index("ix_risk_events_run_status_arm", "run_id", "status", "arm"),
        Index("ix_risk_events_customer_detected_at", "customer_id", "detected_at_sim"),
    )

    id: str = Field(default_factory=lambda: new_id("evt"), primary_key=True)
    run_id: str = Field(foreign_key="runs.id", index=True)
    customer_id: str = Field(foreign_key="customers.id", index=True)

    kind: RiskEventKind = Field(sa_column=enum_column(RiskEventKind))
    # subscription_id or checkout_session_id — deliberately not an FK: it
    # polymorphically references one of two different tables depending on
    # `kind` (section 5.3's shared core abstraction).
    source_id: str

    value_at_risk_paise: int  # MRR x expected months, or cart value
    margin_rate_bps: int  # copied from customer at detection time

    detected_at_sim: datetime
    detected_at_wall: datetime
    detection_rule: str  # which sweep query caught it — shown in UI

    cause_code: CauseCode | None = Field(default=None, sa_column=enum_column(CauseCode, nullable=True))
    cause_confidence: Decimal | None = Field(default=None, sa_column=Column(Numeric(4, 3), nullable=True))
    cause_narrative: str | None = None  # LLM, lazy-generated

    status: RiskEventStatus = Field(default=RiskEventStatus.DETECTED, sa_column=enum_column(RiskEventStatus))
    arm: Arm = Field(sa_column=enum_column(Arm))

    # Exact features at scoring time — reproducibility.
    feature_snapshot: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))
