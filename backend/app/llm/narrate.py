"""
Job 1 (diagnosis narrative) and the cheap fallback job 4 (audit rationale)
leans on too — section 4.4. Both run on every case, so 4.4 explicitly warns
about volume: "Generate narratives lazily — only when a case card is
opened." `diagnose.py` therefore only ever calls `templated_one_liner`; the
real `generate_narrative` is what a stage-7 case-detail endpoint would call
on demand.
"""

from app.models.enums import CauseCode

from .client import call_json

MODEL_HAIKU = "claude-haiku-4-5-20251001"  # 4.4: "jobs 1 and 4 ... high volume, low stakes"

_CAUSE_DESCRIPTIONS = {
    CauseCode.INSUFFICIENT_FUNDS: "the account didn't have enough balance",
    CauseCode.ISSUER_DECLINED: "the issuing bank declined the payment",
    CauseCode.DO_NOT_HONOUR: "the bank refused without a specific reason",
    CauseCode.EXPIRED_CARD: "the card on file has expired",
    CauseCode.MANDATE_REVOKED: "the customer revoked their payment mandate",
    CauseCode.UPI_TIMEOUT: "the UPI request timed out",
    CauseCode.BANK_DOWNTIME: "the bank's systems were briefly down",
    CauseCode.RISK_DECLINED: "the payment was flagged by risk/fraud screening",
    CauseCode.CARD_LIMIT_EXCEEDED: "the card's limit was exceeded",
}
_ORDINALS = {1: "First", 2: "Second", 3: "Third"}


def templated_one_liner(cause_code: CauseCode, attempt_number: int) -> str:
    """The cheap, always-on list-view narrative (4.4's volume mitigation) — no LLM call at all."""
    reason = _CAUSE_DESCRIPTIONS.get(cause_code, "the payment failed")
    ordinal = _ORDINALS.get(attempt_number, f"Attempt #{attempt_number}")
    return f"{ordinal} attempt — {reason}."


def generate_narrative(cause_code: CauseCode, attempt_number: int, context: dict) -> str:
    """The real, lazily-generated narrative (job 1). Falls back to the templated one-liner on any LLM failure (8.6)."""
    system = (
        "You write a two-sentence plain-English diagnosis of a payment failure for a "
        "revenue-recovery operator dashboard. Be specific and concrete, never generic. "
        'Respond with strict JSON: {"narrative": str}.'
    )
    user = f"cause_code={cause_code.value}, attempt_number={attempt_number}, context={context}"
    result = call_json(MODEL_HAIKU, system, user)
    if result is None or "narrative" not in result:
        return templated_one_liner(cause_code, attempt_number)
    return str(result["narrative"])
