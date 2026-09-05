"""Dev-only endpoints (section 8.1: "Alembic is correct engineering and wrong for 24 hours... POST /api/dev/reset instead")."""

from fastapi import APIRouter
from sqlmodel import SQLModel

from app.db import engine
from app.schemas.dev import DevSeedRequest, DevSeedResponse

router = APIRouter(prefix="/api/dev", tags=["dev"])


@router.post("/reset", status_code=204)
def reset() -> None:
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)


@router.post("/seed", status_code=201, response_model=DevSeedResponse)
def seed(body: DevSeedRequest) -> DevSeedResponse:
    # ASSUMED response shape — no JSON example in 8.4; this is a dev-only
    # hook and no screen in the frontend actually calls it (queries.ts has
    # no useDevSeed), so it just echoes the config back for now.
    return DevSeedResponse(ok=True, config=body.config)
