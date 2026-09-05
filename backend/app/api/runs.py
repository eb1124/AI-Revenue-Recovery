"""Runs (section 8.4) — create/list/detail/pause/resume/speed/delete/summary."""

import threading

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.agent.run import create_run, execute_run
from app.agent.run_registry import clear_progress, get_progress, set_speed
from app.api._metrics_compute import compute_run_metrics
from app.db import get_session
from app.models.enums import Arm, RunStatus
from app.models.risk_events import RiskEvent
from app.models.runs import Run, WorldConfig
from app.schemas.common import iso_z
from app.schemas.metrics import RunMetrics
from app.schemas.runs import RunCreateRequest, RunDetail, RunProgress, RunSpeedRequest, RunSummary
from app.schemas.world import WorldConfigOut, WorldParamsOut

router = APIRouter(prefix="/api/runs", tags=["runs"])


def _world_config_out(world_config: WorldConfig) -> WorldConfigOut:
    return WorldConfigOut(id=world_config.id, name=world_config.name, params=WorldParamsOut(**world_config.params), created_at=iso_z(world_config.created_at))


def _progress_for(session: Session, run: Run) -> RunProgress:
    live = get_progress(run.id)
    if live is not None:
        return RunProgress(**live)
    events_processed = len(session.exec(select(RiskEvent.id).where(RiskEvent.run_id == run.id)).all())
    if run.status == RunStatus.COMPLETED:
        return RunProgress(sim_day=run.sim_days, total_days=run.sim_days, events_processed=events_processed, events_total=events_processed)
    return RunProgress(sim_day=0, total_days=run.sim_days, events_processed=events_processed, events_total=0)


def _to_summary(session: Session, run: Run) -> RunSummary:
    return RunSummary(
        id=run.id,
        status=run.status,
        arms=[Arm(a) for a in run.arms],
        population_size=run.population_size,
        sim_days=run.sim_days,
        seed=run.seed,
        progress=_progress_for(session, run),
        started_at=iso_z(run.started_at),
        completed_at=iso_z(run.completed_at) if run.completed_at else None,
    )


def _to_detail(session: Session, run: Run) -> RunDetail:
    world_config = session.get(WorldConfig, run.world_config_id)
    return RunDetail(**_to_summary(session, run).model_dump(), world_config=_world_config_out(world_config))


def _get_or_404(session: Session, run_id: str) -> Run:
    run = session.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    return run


@router.post("", status_code=201, response_model=RunSummary)
def create_run_endpoint(body: RunCreateRequest, session: Session = Depends(get_session)) -> RunSummary:
    world_config = session.get(WorldConfig, body.world_config_id)
    if world_config is None:
        raise HTTPException(404, "world_config not found")

    run = create_run(session, world_config, [a.value for a in body.arms], body.population_size, body.sim_days, body.seed)
    threading.Thread(target=execute_run, args=(run.id,), daemon=True).start()
    return _to_summary(session, run)


@router.get("", response_model=list[RunSummary])
def list_runs(session: Session = Depends(get_session)) -> list[RunSummary]:
    runs = session.exec(select(Run).order_by(Run.created_at.desc())).all()
    return [_to_summary(session, r) for r in runs]


@router.get("/{run_id}", response_model=RunDetail)
def get_run(run_id: str, session: Session = Depends(get_session)) -> RunDetail:
    return _to_detail(session, _get_or_404(session, run_id))


@router.post("/{run_id}/pause", response_model=RunDetail)
def pause_run(run_id: str, session: Session = Depends(get_session)) -> RunDetail:
    run = _get_or_404(session, run_id)
    if run.status == RunStatus.RUNNING:
        run.status = RunStatus.PAUSED
        session.add(run)
        session.commit()
        session.refresh(run)
    return _to_detail(session, run)


@router.post("/{run_id}/resume", response_model=RunDetail)
def resume_run(run_id: str, session: Session = Depends(get_session)) -> RunDetail:
    run = _get_or_404(session, run_id)
    if run.status == RunStatus.PAUSED:
        run.status = RunStatus.RUNNING
        session.add(run)
        session.commit()
        session.refresh(run)
    return _to_detail(session, run)


@router.post("/{run_id}/speed", response_model=RunDetail)
def set_run_speed(run_id: str, body: RunSpeedRequest, session: Session = Depends(get_session)) -> RunDetail:
    run = _get_or_404(session, run_id)
    set_speed(run_id, body.speed)
    return _to_detail(session, run)


@router.delete("/{run_id}", status_code=204)
def delete_run(run_id: str, session: Session = Depends(get_session)) -> None:
    run = _get_or_404(session, run_id)
    session.delete(run)
    session.commit()
    clear_progress(run_id)  # the background thread (if still running) polls for this row and stops on its own


@router.get("/{run_id}/summary", response_model=RunMetrics)
def get_run_summary(run_id: str, session: Session = Depends(get_session)) -> RunMetrics:
    run = _get_or_404(session, run_id)
    if run.status != RunStatus.COMPLETED:
        # Matches the documented frontend behaviour (useRunMetrics, `retry: false`):
        # a still-running/pending/failed run's summary genuinely doesn't exist yet.
        raise HTTPException(404, "run has not completed")
    return compute_run_metrics(session, run)
