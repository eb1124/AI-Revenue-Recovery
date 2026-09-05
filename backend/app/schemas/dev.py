"""Dev-only endpoints (section 8.4)."""

from typing import Any

from pydantic import BaseModel


class DevSeedRequest(BaseModel):
    config: Any


class DevSeedResponse(BaseModel):
    ok: bool
    config: Any
