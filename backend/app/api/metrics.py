"""Model versions (section 7.2, 8.4)."""

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.db import get_session
from app.models.ml import ModelVersion as ModelVersionModel
from app.schemas.common import iso_z
from app.schemas.metrics import ModelVersion

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/models", response_model=list[ModelVersion])
def list_model_versions(session: Session = Depends(get_session)) -> list[ModelVersion]:
    versions = session.exec(select(ModelVersionModel).order_by(ModelVersionModel.trained_at.desc())).all()
    return [
        ModelVersion(id=v.id, name=v.name, algo=v.algo, trained_at=iso_z(v.trained_at), train_rows=v.train_rows, metrics=v.metrics, feature_names=v.feature_names, artifact_path=v.artifact_path)
        for v in versions
    ]
