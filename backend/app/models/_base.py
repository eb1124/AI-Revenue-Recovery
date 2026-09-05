from datetime import UTC, datetime
from enum import Enum

from sqlalchemy import Column, DateTime
from sqlalchemy import Enum as SAEnum
from sqlmodel import Field
from ulid import ULID


def new_id(prefix: str) -> str:
    """TEXT ULID, prefixed by type (section 5.2) — sortable, human-readable, no sequence contention."""
    return f"{prefix}_{ULID()}"


def enum_column(enum_cls: type[Enum], nullable: bool = False) -> Column:
    """
    TEXT + CHECK constraint, not a native Postgres enum type (section 5.2:
    "altering them mid-hackathon is painful"). `values_callable` stores each
    member's lowercase `.value` (e.g. "agent") rather than SQLAlchemy's
    default of the uppercase Python `.name` (e.g. "AGENT").
    """
    return Column(
        SAEnum(
            enum_cls,
            native_enum=False,
            create_constraint=True,  # SQLAlchemy defaults this to False now — without it, no CHECK constraint is emitted at all
            validate_strings=True,
            values_callable=lambda cls: [e.value for e in cls],
        ),
        nullable=nullable,
    )


def utcnow() -> datetime:
    """Real wall-clock time. Never used for agent-authored timestamps — those use SimClock.now (section 8.3)."""
    return datetime.now(UTC)


class TimestampMixin:
    """Every table gets `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` (section 5.2)."""

    # `sa_type` (not `sa_column`) — a mixin field must not share one Column
    # object across every subclass's table; sa_type lets SQLModel build a
    # fresh Column per table from this type.
    created_at: datetime = Field(default_factory=utcnow, sa_type=DateTime(timezone=True), nullable=False)
