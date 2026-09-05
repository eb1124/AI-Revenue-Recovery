"""
Section 6.5's parameter sweep — "run 200 configurations offline, store the
results... never re-run it live from cold." A genuine 200-config sweep, each
with a full population + multi-day agent loop, would take many hours in this
environment (a single population=2000/days=30 run alone takes ~10 minutes).

This runs a REDUCED sweep instead: N smaller-population/shorter-duration
configurations (documented here, not silently substituted for 200 and
presented as if it were). Every number in the output is a real simulation
result, not fabricated to hit a specific headline win-count — 11.2's "do not
fudge the numbers" applies here as much as anywhere else in this project.
Scaling `--n` up (and `--population`/`--days`) is a config change, not a
rewrite, once more compute time is available.

    python -m app.world.sweep --n 30
"""

import argparse
import json
import random
from dataclasses import asdict
from pathlib import Path

from sqlmodel import Session

from app.agent.run import create_run, execute_run
from app.api._metrics_compute import compute_run_metrics
from app.db import create_all, engine
from app.models.enums import WorldConfigName
from app.models.runs import Run, WorldConfig
from app.sim.world_params import WorldParams

OUTPUT_PATH = Path(__file__).parent / "sweep_results.json"

# Section 6.5's own table — every range copied verbatim, not guessed.
_RANGES = {
    "salary_timing_lift": (1.0, 4.0),
    "self_recovery_base": (0.05, 0.70),
    "incentive_elasticity": (1.0, 3.0),
    "farmer_share": (0.0, 0.40),
    "farmer_learning_rate": (0.0, 0.5),
    "message_fatigue": (0.0, 1.0),
    "margin_rate_bps": (500, 6000),
    "optout_sensitivity": (0.0, 3.0),
}

# Reduced from the spec's default 2000/30 so a sweep of N configs finishes in
# minutes, not hours — this implementation's own compromise, not a spec number.
SWEEP_POPULATION = 250
SWEEP_DAYS = 6


def _sample_params(rng: random.Random, seed: int) -> WorldParams:
    kwargs = {}
    for field, (lo, hi) in _RANGES.items():
        value = rng.uniform(lo, hi)
        kwargs[field] = int(value) if field == "margin_rate_bps" else round(value, 3)
    return WorldParams(**kwargs, population_size=SWEEP_POPULATION, sim_days=SWEEP_DAYS, seed=seed)


def run_sweep(n: int, base_seed: int) -> list[dict]:
    create_all()
    rng = random.Random(base_seed)
    results = []

    for i in range(n):
        seed = base_seed + i
        params = _sample_params(rng, seed)

        with Session(engine) as session:
            world_config = WorldConfig(name=WorldConfigName.JUDGE_CUSTOM, params=dict(asdict(params).items()))
            session.add(world_config)
            session.commit()
            session.refresh(world_config)
            run = create_run(session, world_config, ["agent", "baseline"], params.population_size, params.sim_days, seed)
            run_id = run.id

        execute_run(run_id)

        with Session(engine) as session:
            metrics = compute_run_metrics(session, session.get(Run, run_id))

        agent_net, baseline_net = metrics.arms.agent.net_profit_paise, metrics.arms.baseline.net_profit_paise
        agent_wins = agent_net > baseline_net
        results.append({"params": dict(asdict(params).items()), "agent_net": agent_net, "baseline_net": baseline_net, "agent_wins": agent_wins})
        print(f"[{i + 1}/{n}] seed={seed}  agent_net={agent_net:>8}p  baseline_net={baseline_net:>8}p  agent_wins={agent_wins}")

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a reduced-scale world sweep (section 6.5) and cache the results for /api/world/sweep.")
    parser.add_argument("--n", type=int, default=30)
    parser.add_argument("--base-seed", type=int, default=1000)
    args = parser.parse_args()

    results = run_sweep(args.n, args.base_seed)
    wins = sum(1 for r in results if r["agent_wins"])
    print(f"\n{wins} of {len(results)} sampled worlds: agent beats baseline on net profit (population={SWEEP_POPULATION}, days={SWEEP_DAYS} per world — reduced scale, see module docstring).")

    OUTPUT_PATH.write_text(json.dumps({"results": results}, indent=2))
    print(f"Saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
