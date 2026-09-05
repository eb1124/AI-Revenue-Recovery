"""World configs + the parameter sweep (section 6.5, 8.4)."""

import json
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.db import get_session
from app.models.runs import WorldConfig as WorldConfigModel
from app.schemas.common import iso_z
from app.schemas.world import WorldConfigCreateRequest, WorldConfigOut, WorldParamsOut, WorldSweepResponse

router = APIRouter(prefix="/api/world", tags=["world"])

# Populated offline by app/world/sweep.py (6.1: "Pre-compute a parameter
# sweep before the demo... never re-run it live from cold" — 200 full
# simulations would take hours; see that script's own docstring for the
# reduced-scale, honestly-labelled compromise made here).
_SWEEP_ARTIFACT = Path(__file__).resolve().parent.parent / "world" / "sweep_results.json"


def _to_schema(wc: WorldConfigModel) -> WorldConfigOut:
    return WorldConfigOut(id=wc.id, name=wc.name, params=WorldParamsOut(**wc.params), created_at=iso_z(wc.created_at))


@router.get("/configs", response_model=list[WorldConfigOut])
def list_world_configs(session: Session = Depends(get_session)) -> list[WorldConfigOut]:
    return [_to_schema(wc) for wc in session.exec(select(WorldConfigModel)).all()]


@router.post("/configs", status_code=201, response_model=WorldConfigOut)
def create_world_config(body: WorldConfigCreateRequest, session: Session = Depends(get_session)) -> WorldConfigOut:
    wc = WorldConfigModel(name=body.name, params=body.params.model_dump())
    session.add(wc)
    session.commit()
    session.refresh(wc)
    return _to_schema(wc)


@router.get("/sweep", response_model=WorldSweepResponse)
def get_world_sweep() -> WorldSweepResponse:
    if not _SWEEP_ARTIFACT.exists():
        return WorldSweepResponse(results=[])
    return WorldSweepResponse.model_validate(json.loads(_SWEEP_ARTIFACT.read_text()))
