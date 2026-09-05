"""
Hash-chained, append-only audit trail (section 9.6). "The hash chain takes
15 minutes to implement and lets you say 'the audit log is tamper-evident' —
worth far more than 15 minutes of anything else you could build." Every
stage transition in the agent loop writes one entry via `append_entry`;
`verify_chain` recomputes every entry's hash and reports the first place the
chain breaks, exactly what a `POST /api/audit/verify` endpoint (stage 7)
will wrap.
"""

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlmodel import Session, select

from app.models._base import utcnow
from app.models.audit import AuditEntry
from app.models.enums import AuditActor, AuditStage

_GENESIS_HASH = "0" * 64


def _compute_hash(prev_hash: str, payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256((prev_hash + canonical).encode("utf-8")).hexdigest()


def _payload(entry: AuditEntry) -> dict:
    # SQLite (this environment's fallback DB, 5.1) drops tzinfo on
    # round-trip through SQLAlchemy's post-commit attribute refresh — a
    # freshly-inserted entry and one re-fetched later must hash identically
    # either way, so sim_time is normalised to UTC-naive before hashing
    # rather than trusting whatever tzinfo state happens to be attached.
    sim_time = entry.sim_time
    if sim_time.tzinfo is not None:
        sim_time = sim_time.astimezone(UTC).replace(tzinfo=None)
    return {
        "run_id": entry.run_id,
        "risk_event_id": entry.risk_event_id,
        "customer_id": entry.customer_id,
        "stage": entry.stage.value,
        "summary": entry.summary,
        "detail": entry.detail,
        "actor": entry.actor.value,
        "sim_time": sim_time.isoformat(),
    }


def append_entry(
    session: Session,
    *,
    run_id: str,
    stage: AuditStage,
    summary: str,
    actor: AuditActor,
    sim_time: datetime,
    detail: dict[str, Any] | None = None,
    risk_event_id: str | None = None,
    customer_id: str | None = None,
) -> AuditEntry:
    # Linked by insertion order (id — a ULID, lexicographically sortable by
    # creation time), NOT by sim_time: events from the same sim-day are
    # processed in detection order, not sim_time order (checkout `now`s span
    # a whole day, e.g. hour 6 through 22), so sim_time isn't monotonic with
    # respect to when entries are actually appended. Chaining on it would
    # link entry N to whichever row happens to have the closest-but-earlier
    # sim_time rather than whatever was *actually* written immediately
    # before it — a real bug caught by running this against the live loop,
    # not by the (necessarily simpler, strictly-ordered) unit tests.
    prior = session.exec(select(AuditEntry).where(AuditEntry.run_id == run_id).order_by(AuditEntry.id.desc())).first()
    prev_hash = prior.hash if prior else _GENESIS_HASH

    entry = AuditEntry(
        run_id=run_id,
        risk_event_id=risk_event_id,
        customer_id=customer_id,
        stage=stage,
        summary=summary,
        detail=detail or {},
        actor=actor,
        sim_time=sim_time,
        wall_time=utcnow(),
        prev_hash=prev_hash,
        hash="",
    )
    entry.hash = _compute_hash(prev_hash, _payload(entry))
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return entry


@dataclass(frozen=True)
class ChainVerification:
    intact: bool
    broken_entry_id: str | None
    entries_checked: int


def verify_chain(session: Session, run_id: str) -> ChainVerification:
    entries = session.exec(select(AuditEntry).where(AuditEntry.run_id == run_id).order_by(AuditEntry.id)).all()
    expected_prev = _GENESIS_HASH
    for i, entry in enumerate(entries):
        if entry.prev_hash != expected_prev or _compute_hash(entry.prev_hash, _payload(entry)) != entry.hash:
            return ChainVerification(intact=False, broken_entry_id=entry.id, entries_checked=i + 1)
        expected_prev = entry.hash
    return ChainVerification(intact=True, broken_entry_id=None, entries_checked=len(entries))
