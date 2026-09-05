"""World params/configs and the parameter sweep (section 6.5, 8.4)."""

from pydantic import BaseModel

from app.models.enums import WorldConfigName


class WorldParamsOut(BaseModel):
    salary_timing_lift: float
    self_recovery_base: float
    incentive_elasticity: float
    farmer_share: float
    farmer_learning_rate: float
    message_fatigue: float
    margin_rate_bps: int
    optout_sensitivity: float
    population_size: int
    sim_days: int
    seed: int


class WorldConfigOut(BaseModel):
    id: str
    name: WorldConfigName
    params: WorldParamsOut
    created_at: str


class WorldConfigCreateRequest(BaseModel):
    name: WorldConfigName
    params: WorldParamsOut


class WorldSweepResult(BaseModel):
    params: WorldParamsOut
    agent_net: int
    baseline_net: int
    agent_wins: bool


class WorldSweepResponse(BaseModel):
    results: list[WorldSweepResult]
