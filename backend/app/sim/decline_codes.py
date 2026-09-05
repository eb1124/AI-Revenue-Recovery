"""The decline code taxonomy (section 6.3) — real Indian payment failure modes."""

import random
from dataclasses import dataclass

from app.models.enums import CauseCode


@dataclass(frozen=True)
class DeclineCodeInfo:
    share: float
    self_recovery_rate: float


# share, self_recovery_rate — copied verbatim from the 6.3 table.
DECLINE_CODES: dict[CauseCode, DeclineCodeInfo] = {
    CauseCode.INSUFFICIENT_FUNDS: DeclineCodeInfo(0.31, 0.22),
    CauseCode.ISSUER_DECLINED: DeclineCodeInfo(0.18, 0.15),
    CauseCode.DO_NOT_HONOUR: DeclineCodeInfo(0.12, 0.11),
    CauseCode.EXPIRED_CARD: DeclineCodeInfo(0.09, 0.04),
    CauseCode.MANDATE_REVOKED: DeclineCodeInfo(0.07, 0.02),
    CauseCode.UPI_TIMEOUT: DeclineCodeInfo(0.11, 0.58),
    CauseCode.BANK_DOWNTIME: DeclineCodeInfo(0.06, 0.71),
    CauseCode.RISK_DECLINED: DeclineCodeInfo(0.04, 0.08),
    CauseCode.CARD_LIMIT_EXCEEDED: DeclineCodeInfo(0.02, 0.19),
}

CAUSE_CODES = list(DECLINE_CODES.keys())
CAUSE_CODE_SHARES = [info.share for info in DECLINE_CODES.values()]

# Never worth retrying — expired mandate, nothing to retry against (4.6).
NEVER_RETRY_CODES = {CauseCode.EXPIRED_CARD, CauseCode.MANDATE_REVOKED}


def draw_cause_code(rng: random.Random) -> CauseCode:
    """Global 6.3 shares, independent of archetype — shared by sim/events.py and ml/bootstrap_data.py."""
    return rng.choices(CAUSE_CODES, weights=CAUSE_CODE_SHARES)[0]
