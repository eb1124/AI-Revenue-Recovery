"""Runs (section 8.4)."""

from pydantic import BaseModel

from app.models.enums import Arm, RunStatus
from app.schemas.world import WorldConfigOut


class RunProgress(BaseModel):
    sim_day: int
    total_days: int
    events_processed: int
    events_total: int


class RunSummary(BaseModel):
    id: str
    status: RunStatus
    arms: list[Arm]
    population_size: int
    sim_days: int
    seed: int
    progress: RunProgress
    started_at: str
    completed_at: str | None


class RunDetail(RunSummary):
    world_config: WorldConfigOut


class RunCreateRequest(BaseModel):
    world_config_id: str
    arms: list[Arm]
    population_size: int
    sim_days: int
    seed: int


class RunSpeedRequest(BaseModel):
    speed: float
