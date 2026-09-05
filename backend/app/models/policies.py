from typing import Any

from sqlalchemy import JSON, Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, enum_column, new_id
from .enums import PolicyAuthoredBy, PolicyKind


class Policy(TimestampMixin, SQLModel, table=True):
    __tablename__ = "policies"

    id: str = Field(default_factory=lambda: new_id("pol"), primary_key=True)
    name: str  # human-readable, shown in UI
    kind: PolicyKind = Field(sa_column=enum_column(PolicyKind))

    # Structured predicate (section 9.2) — untyped JSONB, same call schemas.ts
    # makes (PolicySchema.rule: z.unknown()): the combinator/op vocabulary is
    # never fully enumerated in the spec.
    rule: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))
    # Action types this policy constrains — JSONB per 5.4, not a join table.
    applies_to: list[str] = Field(default_factory=list, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))

    enabled: bool = True  # toggleable live in the demo
    authored_by: PolicyAuthoredBy = Field(default=PolicyAuthoredBy.SYSTEM, sa_column=enum_column(PolicyAuthoredBy))
    trigger_count: int = 0  # incremented on every block — shown as a badge
