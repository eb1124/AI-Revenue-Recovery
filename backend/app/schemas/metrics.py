"""Run metrics (the Ledger screen, section 8.4) and model versions (7.2)."""

from pydantic import BaseModel


class ArmMetrics(BaseModel):
    events: int
    value_at_risk_paise: int
    recovered_paise: int
    spend_paise: int
    net_profit_paise: int
    incremental_profit_paise: int
    recovery_rate: float
    actions_taken: int
    holds: int
    margin_protected_paise: int
    optouts: int
    messages_sent: int


class RunMetricsDeltas(BaseModel):
    net_profit_vs_baseline_paise: int
    net_profit_vs_baseline_pct: float
    spend_reduction_pct: float
    recovery_rate_delta: float


class RunMetricsSeriesPoint(BaseModel):
    sim_day: int
    agent_net_paise: int
    baseline_net_paise: int
    holdout_net_paise: int


class QiniPoint(BaseModel):
    fraction: float
    agent: float
    random: float


class Qini(BaseModel):
    coefficient: float
    points: list[QiniPoint]


class CalibrationPoint(BaseModel):
    predicted: float
    observed: float
    n: int


class RunMetricsArms(BaseModel):
    agent: ArmMetrics
    baseline: ArmMetrics
    holdout: ArmMetrics


class RunMetrics(BaseModel):
    run_id: str
    arms: RunMetricsArms
    deltas: RunMetricsDeltas
    series: list[RunMetricsSeriesPoint]
    qini: Qini
    calibration: list[CalibrationPoint]


class ModelVersion(BaseModel):
    id: str
    name: str
    algo: str
    trained_at: str
    train_rows: int
    metrics: dict[str, float]
    feature_names: list[str]
    artifact_path: str
