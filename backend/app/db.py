from sqlmodel import Session, SQLModel, create_engine

from . import models  # noqa: F401 — registers every table on SQLModel.metadata
from .config import settings

# Migrations: none — create_all() + a POST /api/dev/reset endpoint (stage 7).
# Section 8.1: "Alembic is correct engineering and wrong for 24 hours."
#
# `connect_args` only matters for the SQLite fallback (5.1) — stage 7's API
# runs a sim in a background thread (POST /api/runs returns immediately) while
# request-handling threads read the same DB concurrently. SQLite's default
# forbids reusing a connection across threads and has no write-lock wait, so
# without these two options the API layer would intermittently hit "SQLite
# objects created in a thread can only be used in that same thread" or
# "database is locked" the moment a run and a request overlap. Postgres has
# neither limitation and ignores connect_args it doesn't recognise... except
# psycopg does *not* ignore unknown kwargs, so this is gated on the URL scheme.
_connect_args = {"check_same_thread": False, "timeout": 15} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, echo=False, connect_args=_connect_args)


def create_all() -> None:
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
