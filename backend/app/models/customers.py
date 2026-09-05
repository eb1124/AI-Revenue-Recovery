from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, Column, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, enum_column, new_id
from .enums import FarmingTier, Language, Segment


class Customer(TimestampMixin, SQLModel, table=True):
    __tablename__ = "customers"

    id: str = Field(default_factory=lambda: new_id("cus"), primary_key=True)
    display_name: str
    email: str
    phone: str  # E.164, +91...
    city: str
    preferred_language: Language = Field(sa_column=enum_column(Language))
    whatsapp_opted_in: bool = False
    email_opted_in: bool = False
    signup_at: datetime

    segment: Segment = Field(sa_column=enum_column(Segment))
    ltv_realised_paise: int = 0
    ltv_expected_paise: int = 0
    gross_margin_bps: int  # 2200 = 22%, varies by segment

    salary_day_of_month: int | None = None  # ground truth, sim-only
    inferred_salary_day: int | None = None  # what the agent worked out

    farming_score: Decimal = Field(default=Decimal("0.000"), sa_column=Column(Numeric(4, 3), nullable=False))
    farming_tier: FarmingTier = Field(default=FarmingTier.NORMAL, sa_column=enum_column(FarmingTier))
    # The five component scores (section 4.5), for the Watchlist UI breakdown.
    farming_signals: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))

    contactable_after: datetime | None = None  # cool-down enforcement
    hard_optout: bool = False
