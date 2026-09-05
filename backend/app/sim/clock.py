"""
The sim clock (section 8.3). One class, governs every timestamp the live
agent loop writes. Batch generation (app/sim/sweep.py, stage 2) computes
simulated timestamps directly via date arithmetic instead — SimClock's `now`
is wall-clock-driven (real seconds x speed), which only makes sense once
something is actually running live and needs to be watchable (stages 5/7).
"""

from datetime import UTC, datetime, timedelta


def _real_now() -> datetime:
    return datetime.now(UTC)


class SimClock:
    def __init__(self, start: datetime, speed: float = 2880):  # 2880x -> 1 sim day per 30 real seconds
        self._speed = speed
        self._paused = False
        self._wall_anchor = _real_now()
        self._sim_anchor = start

    @property
    def now(self) -> datetime:
        if self._paused:
            return self._sim_anchor
        elapsed_wall_seconds = (_real_now() - self._wall_anchor).total_seconds()
        return self._sim_anchor + timedelta(seconds=elapsed_wall_seconds * self._speed)

    def pause(self) -> None:
        if self._paused:
            return
        self._sim_anchor = self.now
        self._paused = True

    def resume(self) -> None:
        if not self._paused:
            return
        self._wall_anchor = _real_now()
        self._paused = False

    def set_speed(self, speed: float) -> None:
        # Re-anchor first so changing speed doesn't jump `now`.
        self._sim_anchor = self.now
        self._wall_anchor = _real_now()
        self._speed = speed
