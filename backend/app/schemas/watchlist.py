"""Watchlist (farming detection, section 4.5/10.9). No JSON example exists in 8.4 — reconstructed from the 10.9 UI mockup, matching frontend/src/api/schemas.ts's own reconstruction exactly."""

from pydantic import BaseModel

from app.models.enums import FarmingTier
from app.schemas.cases import FarmingSignals, RecentEvent


class WatchlistEntry(BaseModel):
    customer_id: str
    display_name: str
    farming_tier: FarmingTier
    farming_score: float
    abandons: int
    checkouts_observed: int
    incentives_sent: int
    incentives_extracted_paise: int


class WatchlistScorePoint(BaseModel):
    at: str
    score: float


class WatchlistDetail(WatchlistEntry):
    score_timeline: list[WatchlistScorePoint]
    farming_signals: FarmingSignals
    events: list[RecentEvent]
