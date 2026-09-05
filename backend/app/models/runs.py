from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, enum_column, new_id
from .enums import RunStatus, WorldConfigName


class WorldConfig(TimestampMixin, SQLModel, table=True):
    """The adversarial knobs (section 6.5)."""

    __tablename__ = "world_configs"

    # 5.4 gives no explicit prefix for this table's id; "wcf" extends the
    # same by-type-prefix convention (section 5.2).
    id: str = Field(default_factory=lambda: new_id("wcf"), primary_key=True)
    name: WorldConfigName = Field(sa_column=enum_column(WorldConfigName))
    params: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))


class Run(TimestampMixin, SQLModel, table=True):
    __tablename__ = "runs"

    id: str = Field(default_factory=lambda: new_id("run"), primary_key=True)
    world_config_id: str = Field(foreign_key="world_configs.id", index=True)

    # ["agent", "baseline", "holdout"] — section 3.2 wants all three by default.
    arms: list[str] = Field(default_factory=list, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))
    population_size: int
    sim_days: int
    status: RunStatus = Field(default=RunStatus.PENDING, sa_column=enum_column(RunStatus))
    seed: int  # reproducibility. Critical.

    started_at: datetime | None = None
    completed_at: datetime | None = None
    # Cached final metrics (RunMetrics shape, section 8.4) — populated on completion.
    summary: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON().with_variant(JSONB(), "postgresql"), nullable=True))
