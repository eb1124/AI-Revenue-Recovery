from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, enum_column, new_id
from .enums import Action as ActionType
from .enums import ActionStatus, Channel, Language, Tone


class ActionRecord(TimestampMixin, SQLModel, table=True):
    # Named ActionRecord, not Action — "Action" is the six-item enum
    # (section 4.1) that this table's own `type` column uses.
    __tablename__ = "actions"

    id: str = Field(default_factory=lambda: new_id("act"), primary_key=True)
    decision_id: str = Field(foreign_key="decisions.id", index=True)
    risk_event_id: str = Field(foreign_key="risk_events.id", index=True)  # denormalised for query speed

    type: ActionType = Field(sa_column=enum_column(ActionType))
    params: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))

    scheduled_for_sim: datetime
    executed_at_sim: datetime | None = None
    status: ActionStatus = Field(default=ActionStatus.SCHEDULED, sa_column=enum_column(ActionStatus))
    # e.g. customer self-recovered before the scheduled retry.
    cancel_reason: str | None = None
    cost_paise: int = 0  # realised cost


class Message(TimestampMixin, SQLModel, table=True):
    __tablename__ = "messages"

    id: str = Field(default_factory=lambda: new_id("msg"), primary_key=True)
    action_id: str = Field(foreign_key="actions.id", index=True)

    channel: Channel = Field(sa_column=enum_column(Channel))
    language: Language = Field(sa_column=enum_column(Language))
    body: str  # LLM-composed, real text
    incentive_bps: int = 0  # 0 for free nudges
    tone: Tone = Field(sa_column=enum_column(Tone))

    policy_checks_passed: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))
    sent_at_sim: datetime | None = None
    opened: bool = False  # simulated
    clicked: bool = False  # simulated
