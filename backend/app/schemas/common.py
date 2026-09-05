"""
Shared response-shaping helpers (section 8.4). `frontend/src/api/schemas.ts`
is the authoritative contract; every response model in `app/schemas/` is
built to match it field-for-field.
"""

from datetime import UTC, datetime


def iso_z(dt: datetime) -> str:
    """
    `IsoDateTime = z.string().datetime()` on the frontend, with no
    `{offset: true}`, means zod's strict mode: it accepts a literal "Z"
    suffix and rejects "+00:00" outright. Our sim-time datetimes are
    deliberately naive (app/agent/run.py's SQLite-roundtrip fix) and
    `wall_time`/`created_at` are tz-aware UTC (`app/models/_base.utcnow`) —
    both need to end up serialized the same strict way, so every timestamp
    in an API response goes through this function rather than relying on
    Pydantic's default datetime encoding (which emits "+00:00", not "Z").
    """
    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)
    return aware.astimezone(UTC).isoformat().replace("+00:00", "Z")
