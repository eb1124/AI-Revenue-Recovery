from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, Column, Index, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, enum_column, new_id
from .enums import Action, DecidedBy, ReasonCode


class Decision(TimestampMixin, SQLModel, table=True):
    __tablename__ = "decisions"

    id: str = Field(default_factory=lambda: new_id("dec"), primary_key=True)
    risk_event_id: str = Field(foreign_key="risk_events.id", index=True)

    chosen_action: Action = Field(sa_column=enum_column(Action))
    # timing, channel, language, incentive_bps (section 4.6's second-stage params).
    chosen_params: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))
    reason_code: ReasonCode = Field(sa_column=enum_column(ReasonCode))

    p_baseline: Decimal = Field(sa_column=Column(Numeric(5, 4), nullable=False))
    best_ev_paise: int  # can be negative
    best_ev_ci_low_paise: int
    best_ev_ci_high_paise: int
    # If HOLD: what we avoided spending. The signature metric (section 5.4).
    # Null for non-HOLD decisions — the concept doesn't apply to them.
    hold_margin_protected_paise: int | None = None

    blocked_actions: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))
    decided_by: DecidedBy = Field(default=DecidedBy.ENGINE, sa_column=enum_column(DecidedBy))
    llm_rationale: str | None = None
    latency_ms: int
    decided_at_sim: datetime


class DecisionCandidate(TimestampMixin, SQLModel, table=True):
    """One row per action considered — turns 'trust me' into 'here is the arithmetic' (section 5.4)."""

    __tablename__ = "decision_candidates"
    __table_args__ = (Index("ix_decision_candidates_decision_rank", "decision_id", "rank"),)

    # 5.4 gives no explicit prefix for this table's id (unlike its siblings);
    # "cnd" extends the same by-type-prefix convention (section 5.2).
    id: str = Field(default_factory=lambda: new_id("cnd"), primary_key=True)
    decision_id: str = Field(foreign_key="decisions.id", index=True)

    action: Action = Field(sa_column=enum_column(Action))
    p_recover: Decimal = Field(sa_column=Column(Numeric(5, 4), nullable=False))
    uplift: Decimal = Field(sa_column=Column(Numeric(5, 4), nullable=False))

    gross_gain_paise: int
    direct_cost_paise: int
    incentive_cost_paise: int
    annoyance_cost_paise: int
    farming_cost_paise: int
    ev_paise: int
    ci_low_paise: int
    ci_high_paise: int

    allowed: bool = True
    block_reason: str | None = None
    rank: int
