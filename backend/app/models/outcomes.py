from datetime import datetime

from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, enum_column, new_id
from .enums import ResolutionPath


class Outcome(TimestampMixin, SQLModel, table=True):
    __tablename__ = "outcomes"

    # 5.4 gives no explicit prefix for this table's id; "out" extends the
    # same by-type-prefix convention (section 5.2).
    id: str = Field(default_factory=lambda: new_id("out"), primary_key=True)
    risk_event_id: str = Field(foreign_key="risk_events.id", unique=True, index=True)

    resolved: bool  # did the money arrive?
    resolution_path: ResolutionPath = Field(sa_column=enum_column(ResolutionPath))
    recovered_paise: int = 0
    total_cost_paise: int = 0  # sum of all action costs
    net_profit_paise: int  # the number that matters

    # What the oracle says would have happened under HOLD — sim-only ground truth.
    counterfactual_recovered_paise: int
    # net_profit - counterfactual x m. The scoreboard number.
    incremental_profit_paise: int

    customer_opted_out: bool = False
    resolved_at_sim: datetime
