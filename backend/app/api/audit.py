"""Audit trail (section 9.6, 8.4) — list/filter, chain verification, CSV export."""

import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlmodel import Session, select

from app.audit import verify_chain
from app.db import get_session
from app.models.audit import AuditEntry as AuditEntryModel
from app.models.enums import AuditStage
from app.schemas.audit import AuditEntry, AuditListResponse, AuditVerifyResponse
from app.schemas.common import iso_z

router = APIRouter(prefix="/api/audit", tags=["audit"])

_CSV_COLUMNS = ["id", "run_id", "risk_event_id", "customer_id", "stage", "summary", "actor", "sim_time", "wall_time", "prev_hash", "hash"]


def _to_schema(e: AuditEntryModel) -> AuditEntry:
    return AuditEntry(
        id=e.id, run_id=e.run_id, risk_event_id=e.risk_event_id, customer_id=e.customer_id, stage=e.stage, summary=e.summary, detail=e.detail,
        actor=e.actor, sim_time=iso_z(e.sim_time), wall_time=iso_z(e.wall_time), prev_hash=e.prev_hash, hash=e.hash,
    )


def _filtered(session: Session, run_id: str | None, stage: AuditStage | None, customer_id: str | None, q: str | None) -> list[AuditEntryModel]:
    query = select(AuditEntryModel)
    if run_id:
        query = query.where(AuditEntryModel.run_id == run_id)
    if stage:
        query = query.where(AuditEntryModel.stage == stage)
    if customer_id:
        query = query.where(AuditEntryModel.customer_id == customer_id)
    entries = session.exec(query.order_by(AuditEntryModel.id)).all()
    if q:
        ql = q.lower().strip()
        entries = [e for e in entries if ql in e.id.lower() or ql in e.summary.lower() or ql in e.actor.value.lower()]
    return entries


@router.get("", response_model=AuditListResponse)
def list_audit(
    run_id: str | None = None,
    stage: AuditStage | None = None,
    customer_id: str | None = None,
    q: str | None = None,
    cursor: str | None = None,
    limit: int = Query(50, le=1000),
    session: Session = Depends(get_session),
) -> AuditListResponse:
    entries = _filtered(session, run_id, stage, customer_id, q)
    offset = int(cursor) if cursor else 0
    page = entries[offset : offset + limit]
    next_cursor = str(offset + limit) if offset + limit < len(entries) else None
    return AuditListResponse(items=[_to_schema(e) for e in page], next_cursor=next_cursor)


@router.get("/verify", response_model=AuditVerifyResponse)
def verify(run_id: str | None = None, session: Session = Depends(get_session)) -> AuditVerifyResponse:
    # The hash chain is per-run (each run starts fresh from the genesis hash,
    # app/audit.py) — there is no single chain spanning every run, so
    # "verify everything" (no run_id, matching the documented frontend
    # behaviour) means verifying each run's own chain and reporting the
    # first break found across all of them.
    run_ids = [run_id] if run_id else session.exec(select(AuditEntryModel.run_id).distinct()).all()

    total_checked = 0
    for rid in run_ids:
        result = verify_chain(session, rid)
        total_checked += result.entries_checked
        if not result.intact:
            return AuditVerifyResponse(intact=False, entries_checked=total_checked, broken_at_entry=result.entries_checked - 1)
    return AuditVerifyResponse(intact=True, entries_checked=total_checked, broken_at_entry=None)


@router.get("/export.csv")
def export_csv(
    run_id: str | None = None, stage: AuditStage | None = None, customer_id: str | None = None, q: str | None = None, session: Session = Depends(get_session)
) -> Response:
    entries = _filtered(session, run_id, stage, customer_id, q)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(_CSV_COLUMNS)
    for e in entries:
        writer.writerow([e.id, e.run_id, e.risk_event_id or "", e.customer_id or "", e.stage.value, e.summary, e.actor.value, iso_z(e.sim_time), iso_z(e.wall_time), e.prev_hash, e.hash])
    return Response(content=buffer.getvalue(), media_type="text/csv")
