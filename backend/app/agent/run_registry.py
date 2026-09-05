"""
In-process, in-memory progress tracking for background-thread runs (stage 7).
The DB remains the source of truth for pause/resume (`runs.status`, polled by
the background thread itself in run.py) — this registry exists only because
`events_total` (8.4's `RunSummary.progress`) is a live *estimate*
extrapolated from the current rate, which isn't a column any table has a
reason to store permanently.
"""

import threading

_progress: dict[str, dict] = {}
_speed: dict[str, float] = {}
_lock = threading.Lock()

DEFAULT_SPEED = 2880.0  # 6.5/8.3's own default: 1 sim day per 30 real seconds


def set_progress(run_id: str, *, sim_day: int, total_days: int, events_processed: int, events_total: int) -> None:
    with _lock:
        _progress[run_id] = {"sim_day": sim_day, "total_days": total_days, "events_processed": events_processed, "events_total": events_total}


def get_progress(run_id: str) -> dict | None:
    with _lock:
        entry = _progress.get(run_id)
        return dict(entry) if entry else None


def clear_progress(run_id: str) -> None:
    with _lock:
        _progress.pop(run_id, None)
        _speed.pop(run_id, None)


def set_speed(run_id: str, speed: float) -> None:
    """
    Display-only: this run loop is a batch simulation (a whole day resolves
    in one pass, not paced against a wall clock), so there's no real-time
    tick rate to actually change — but `run.progress`'s SSE payload (8.5)
    and `POST /runs/{id}/speed` still need *some* number to round-trip.
    """
    with _lock:
        _speed[run_id] = speed


def get_speed(run_id: str) -> float:
    with _lock:
        return _speed.get(run_id, DEFAULT_SPEED)
