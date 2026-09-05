from datetime import datetime

from sqlalchemy import JSON, Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from ._base import TimestampMixin, new_id


class ModelVersion(TimestampMixin, SQLModel, table=True):
    __tablename__ = "model_versions"

    # 5.4 gives no explicit prefix for this table's id; "mdl" extends the
    # same by-type-prefix convention (section 5.2).
    id: str = Field(default_factory=lambda: new_id("mdl"), primary_key=True)

    # 5.4 writes `name`/`algo` with an explicit trailing ellipsis ("p_baseline
    # | p_recover_nudge_free | ...") rather than a closed pipe-list — the full
    # ~7-model vocabulary is never enumerated. Left as plain TEXT (no CHECK
    # constraint), matching schemas.ts's ModelVersionSchema, which leaves both
    # as z.string() for the same reason.
    name: str
    algo: str
    trained_at: datetime
    train_rows: int

    # AUC, Brier score, calibration error, Qini coefficient (section 7.6).
    metrics: dict[str, float] = Field(default_factory=dict, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))
    feature_names: list[str] = Field(default_factory=list, sa_column=Column(JSON().with_variant(JSONB(), "postgresql")))
    artifact_path: str  # joblib file
