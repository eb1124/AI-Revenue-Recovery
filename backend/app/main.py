"""FastAPI app (section 8.1/8.4) — CORS, router mounting, startup."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import audit, cases, dev, metrics, policies, runs, stream, watchlist, world
from app.db import create_all


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    create_all()
    yield


app = FastAPI(title="HOLD API", description="Revenue-recovery agent cockpit backend (section 8.4).", lifespan=lifespan)

# Vite's default dev port (5173) and its preview-build port (4173) — this is
# a local demo backend, not a public deployment, so the allowlist is small
# and explicit rather than a wildcard.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(runs.router)
app.include_router(stream.router)
app.include_router(cases.router)
app.include_router(watchlist.router)
app.include_router(policies.router)
app.include_router(world.router)
app.include_router(audit.router)
app.include_router(metrics.router)
app.include_router(dev.router)


@app.get("/")
def root() -> dict:
    return {"name": "HOLD API", "docs": "/docs"}
