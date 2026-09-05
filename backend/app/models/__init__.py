"""
Importing this package registers every table on SQLModel.metadata — required
before db.create_all() so it actually creates all 15 tables (section 5.4),
not just whichever ones happened to be imported elsewhere first.
"""

from .actions import ActionRecord, Message
from .audit import AuditEntry
from .billing import CheckoutSession, PaymentAttempt, Subscription
from .customers import Customer
from .decisions import Decision, DecisionCandidate
from .ml import ModelVersion
from .outcomes import Outcome
from .policies import Policy
from .risk_events import RiskEvent
from .runs import Run, WorldConfig

__all__ = [
    "ActionRecord",
    "AuditEntry",
    "CheckoutSession",
    "Customer",
    "Decision",
    "DecisionCandidate",
    "Message",
    "ModelVersion",
    "Outcome",
    "PaymentAttempt",
    "Policy",
    "RiskEvent",
    "Run",
    "Subscription",
    "WorldConfig",
]
