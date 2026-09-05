"""
Enum vocabulary for every TEXT-with-CHECK-constraint column in section 5.4.

Values are copied verbatim from the spec's pipe-separated lists (5.4, 6.3,
4.1) and cross-checked against frontend/src/api/schemas.ts, which the task
brief names as authoritative over prose. No conflicts were found between the
two — every enum below matches its schemas.ts counterpart exactly.

A few tables reference enums schemas.ts never needed to model (billing-vertical
internals like `subscriptions.mandate_type` never cross the API boundary as
their own field) — those are sourced from 5.4's column tables directly and
marked below.
"""

from enum import Enum


class Arm(str, Enum):
    AGENT = "agent"
    BASELINE = "baseline"
    HOLDOUT = "holdout"


class RunStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


class Segment(str, Enum):
    NEW = "new"
    CASUAL = "casual"
    REGULAR = "regular"
    POWER = "power"


class Language(str, Enum):
    EN = "en"
    HINGLISH = "hinglish"
    TA = "ta"


class FarmingTier(str, Enum):
    NORMAL = "normal"
    WATCH = "watch"
    FLAGGED = "flagged"


# --- subscriptions (5.4) — DB-internal, not part of the 8.4 API surface -----


class PlanName(str, Enum):
    BASIC = "basic"
    PLUS = "plus"
    PRO = "pro"


class MandateType(str, Enum):
    UPI_AUTOPAY = "upi_autopay"
    CARD = "card"
    NACH = "nach"


class MandateStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    REVOKED = "revoked"
    EXPIRED = "expired"


class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELLED = "cancelled"


# --- checkout_sessions (5.4) -------------------------------------------------


class Category(str, Enum):
    GROCERY = "grocery"
    ELECTRONICS = "electronics"
    FASHION = "fashion"
    PHARMACY = "pharmacy"


class PaymentMethod(str, Enum):
    UPI = "upi"
    CARD = "card"
    NETBANKING = "netbanking"
    COD = "cod"
    WALLET = "wallet"


class CheckoutStage(str, Enum):
    CART = "cart"
    ADDRESS = "address"
    PAYMENT_SELECTED = "payment_selected"
    PAYMENT_INITIATED = "payment_initiated"
    PAID = "paid"
    ABANDONED = "abandoned"


class Device(str, Enum):
    ANDROID = "android"
    IOS = "ios"
    WEB = "web"


# --- payment_attempts (5.4) --------------------------------------------------
# NOTE: `method` has no enumerated value list in 5.4 (unlike every other
# column in this table) — left as a plain `str` column on PaymentAttempt
# rather than invented here.


class Gateway(str, Enum):
    RAZORPAY = "razorpay"
    PAYU = "payu"
    CASHFREE = "cashfree"


class Issuer(str, Enum):
    HDFC = "hdfc"
    ICICI = "icici"
    SBI = "sbi"
    AXIS = "axis"
    KOTAK = "kotak"


class PaymentAttemptStatus(str, Enum):
    INITIATED = "initiated"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"


class TriggeredBy(str, Enum):
    SCHEDULED = "scheduled"
    AGENT_RETRY = "agent_retry"
    CUSTOMER = "customer"


# --- decline code taxonomy (6.3) — shared by payment_attempts.decline_code
# and risk_events.cause_code ---------------------------------------------


class CauseCode(str, Enum):
    INSUFFICIENT_FUNDS = "insufficient_funds"
    ISSUER_DECLINED = "issuer_declined"
    DO_NOT_HONOUR = "do_not_honour"
    EXPIRED_CARD = "expired_card"
    MANDATE_REVOKED = "mandate_revoked"
    UPI_TIMEOUT = "upi_timeout"
    BANK_DOWNTIME = "bank_downtime"
    RISK_DECLINED = "risk_declined"
    CARD_LIMIT_EXCEEDED = "card_limit_exceeded"


# --- risk_events (5.4) -------------------------------------------------------


class RiskEventKind(str, Enum):
    FAILED_RENEWAL = "failed_renewal"
    ABANDONED_CHECKOUT = "abandoned_checkout"


class RiskEventStatus(str, Enum):
    DETECTED = "detected"
    DIAGNOSED = "diagnosed"
    SCORED = "scored"
    DECIDED = "decided"
    ACTING = "acting"
    RESOLVED = "resolved"
    EXPIRED = "expired"


# --- decisions (5.4) / action space (4.1) ------------------------------------


class Action(str, Enum):
    HOLD = "HOLD"
    RETRY_NOW = "RETRY_NOW"
    RETRY_SCHEDULED = "RETRY_SCHEDULED"
    NUDGE_FREE = "NUDGE_FREE"
    NUDGE_INCENTIVE = "NUDGE_INCENTIVE"
    ESCALATE_HUMAN = "ESCALATE_HUMAN"


class ReasonCode(str, Enum):
    POSITIVE_EV = "positive_ev"
    NO_ACTION_BEATS_HOLD = "no_action_beats_hold"
    UNCERTAIN_UPLIFT = "uncertain_uplift"
    EDGE_TOO_THIN = "edge_too_thin"
    POLICY_BLOCKED = "policy_blocked"
    HIGH_VALUE_AMBIGUOUS = "high_value_ambiguous"


class DecidedBy(str, Enum):
    ENGINE = "engine"
    LLM_ADJUDICATOR = "llm_adjudicator"
    HUMAN_OVERRIDE = "human_override"


# --- actions (5.4) -----------------------------------------------------------


class ActionStatus(str, Enum):
    SCHEDULED = "scheduled"
    EXECUTED = "executed"
    CANCELLED = "cancelled"
    BLOCKED = "blocked"


# --- messages (5.4) -----------------------------------------------------------


class Channel(str, Enum):
    WHATSAPP = "whatsapp"
    EMAIL = "email"
    SMS = "sms"


class Tone(str, Enum):
    WARM = "warm"
    NEUTRAL = "neutral"
    URGENT = "urgent"


# --- outcomes (5.4) -----------------------------------------------------------


class ResolutionPath(str, Enum):
    SELF_RECOVERED = "self_recovered"
    AGENT_RECOVERED = "agent_recovered"
    LOST = "lost"
    EXPIRED = "expired"


# --- policies (5.4) -----------------------------------------------------------


class PolicyKind(str, Enum):
    HARD_BLOCK = "hard_block"
    CAP = "cap"
    REQUIRE_APPROVAL = "require_approval"


class PolicyAuthoredBy(str, Enum):
    SYSTEM = "system"
    OPERATOR = "operator"
    LLM_PROPOSAL = "llm_proposal"


# --- audit_entries (5.4) -------------------------------------------------------


class AuditStage(str, Enum):
    DETECT = "detect"
    DIAGNOSE = "diagnose"
    SCORE = "score"
    DECIDE = "decide"
    ACT = "act"
    VERIFY = "verify"
    POLICY = "policy"
    OVERRIDE = "override"


class AuditActor(str, Enum):
    ENGINE = "engine"
    LLM = "llm"
    HUMAN = "human"
    SIMULATOR = "simulator"


# --- world_configs (5.4) -------------------------------------------------------


class WorldConfigName(str, Enum):
    DEFAULT = "default"
    PESSIMISTIC = "pessimistic"
    JUDGE_CUSTOM = "judge_custom"
