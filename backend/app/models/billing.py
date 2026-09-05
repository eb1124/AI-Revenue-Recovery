from datetime import datetime

from sqlalchemy import Index
from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, enum_column, new_id
from .enums import (
    Category,
    CauseCode,
    CheckoutStage,
    Device,
    Gateway,
    Issuer,
    MandateStatus,
    MandateType,
    PaymentAttemptStatus,
    PaymentMethod,
    PlanName,
    SubscriptionStatus,
    TriggeredBy,
)


class Subscription(TimestampMixin, SQLModel, table=True):
    __tablename__ = "subscriptions"

    id: str = Field(default_factory=lambda: new_id("sub"), primary_key=True)
    customer_id: str = Field(foreign_key="customers.id", index=True)

    plan_name: PlanName = Field(sa_column=enum_column(PlanName))
    mrr_paise: int
    billing_day: int  # 1-28

    mandate_type: MandateType = Field(sa_column=enum_column(MandateType))
    mandate_status: MandateStatus = Field(sa_column=enum_column(MandateStatus))
    mandate_expires_at: datetime | None = None
    consecutive_failures: int = 0

    status: SubscriptionStatus = Field(sa_column=enum_column(SubscriptionStatus))
    started_at: datetime
    cancelled_at: datetime | None = None


class CheckoutSession(TimestampMixin, SQLModel, table=True):
    __tablename__ = "checkout_sessions"
    # 5.5: the index that stops the sweep loop from table-scanning every 5s.
    __table_args__ = (Index("ix_checkout_sessions_stage_entered_at", "stage", "stage_entered_at"),)

    id: str = Field(default_factory=lambda: new_id("cko"), primary_key=True)
    customer_id: str = Field(foreign_key="customers.id", index=True)

    cart_value_paise: int
    item_count: int
    category: Category = Field(sa_column=enum_column(Category))
    delivery_fee_paise: int  # the fee-shock abandonment driver
    payment_method: PaymentMethod = Field(sa_column=enum_column(PaymentMethod))

    stage: CheckoutStage = Field(sa_column=enum_column(CheckoutStage))
    stage_entered_at: datetime  # drives the abandonment timer

    device: Device = Field(sa_column=enum_column(Device))
    started_at: datetime
    completed_at: datetime | None = None


class PaymentAttempt(TimestampMixin, SQLModel, table=True):
    __tablename__ = "payment_attempts"
    __table_args__ = (Index("ix_payment_attempts_subscription_attempted_at", "subscription_id", "attempted_at"),)

    id: str = Field(default_factory=lambda: new_id("pay"), primary_key=True)
    customer_id: str = Field(foreign_key="customers.id", index=True)
    # Exactly one of these two is set (5.4).
    subscription_id: str | None = Field(default=None, foreign_key="subscriptions.id")
    checkout_session_id: str | None = Field(default=None, foreign_key="checkout_sessions.id")

    amount_paise: int
    # 5.4 gives no enumerated value list for `method` (unlike every sibling
    # column in this table) — left as free text rather than an invented enum.
    method: str
    gateway: Gateway = Field(sa_column=enum_column(Gateway))
    issuer: Issuer = Field(sa_column=enum_column(Issuer))
    status: PaymentAttemptStatus = Field(sa_column=enum_column(PaymentAttemptStatus))
    decline_code: CauseCode | None = Field(default=None, sa_column=enum_column(CauseCode, nullable=True))

    attempt_number: int  # 1-indexed within a risk event
    triggered_by: TriggeredBy = Field(sa_column=enum_column(TriggeredBy))
    attempted_at: datetime
