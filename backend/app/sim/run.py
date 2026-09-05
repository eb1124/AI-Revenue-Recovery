"""
Standalone entry point for the simulator (session-12 stage 2 brief):

    python -m app.sim.run --seed 42 --days 30

Generates a population, runs the sweep across `--days` simulated days,
persists everything to the DB (via app/db.py — same tables stage 1 built),
and prints a summary. No agent exists yet (stage 5) — every checkout/renewal
resolves purely against the response oracle's implicit-HOLD path, i.e. this
*is* what the world looks like with nobody intervening.
"""

import argparse
import random
from collections import Counter
from datetime import UTC, datetime

from sqlmodel import Session

from app.db import create_all, engine

from .decline_codes import DECLINE_CODES
from .population import generate_population
from .sweep import run_sweep
from .world_params import WorldParams

SIM_START = datetime(2026, 8, 1, tzinfo=UTC)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the HOLD simulator standalone and print a summary.")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--population", type=int, default=2000)
    args = parser.parse_args()

    params = WorldParams(seed=args.seed, sim_days=args.days, population_size=args.population)
    rng = random.Random(args.seed)

    print(f"Generating {params.population_size} customers (seed={params.seed})...")
    population = generate_population(params.population_size, SIM_START, params, rng)

    print(f"Running the sweep across {params.sim_days} sim-days...")
    result = run_sweep(population, SIM_START, params.sim_days, params, rng)

    create_all()
    with Session(engine) as session:
        for sim_customer in population:
            session.add(sim_customer.row)
            if sim_customer.subscription is not None:
                session.add(sim_customer.subscription)
        for checkout in result.checkouts:
            session.add(checkout)
        for attempt in result.payment_attempts:
            session.add(attempt)
        session.commit()

    print_summary(population, result, params)


def print_summary(population, result, params: WorldParams) -> None:
    archetype_counts = Counter(c.archetype.value for c in population)
    subscribed = sum(1 for c in population if c.has_subscription)

    checkout_events = [e for e in result.events if e.kind == "abandoned_checkout"]
    renewal_events = [e for e in result.events if e.kind == "failed_renewal"]
    risky_checkouts = [e for e in checkout_events if e.abandoned_or_failed]
    risky_renewals = [e for e in renewal_events if e.abandoned_or_failed]
    all_risky = risky_checkouts + risky_renewals

    print("\n" + "=" * 72)
    print(f"HOLD SIMULATOR — seed={params.seed}  days={params.sim_days}  population={params.population_size}")
    print("=" * 72)

    print("\nPopulation by archetype:")
    for archetype, count in sorted(archetype_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {archetype:<18} {count:>6}  ({count / len(population):.1%})")
    print(f"  {'with subscription':<18} {subscribed:>6}  ({subscribed / len(population):.1%})")

    print(f"\nCheckout sessions generated: {len(checkout_events)}")
    if checkout_events:
        print(f"  abandoned/stalled: {len(risky_checkouts)} ({len(risky_checkouts) / len(checkout_events):.1%})")
    print(f"Renewal attempts generated:  {len(renewal_events)}")
    if renewal_events:
        print(f"  failed:            {len(risky_renewals)} ({len(risky_renewals) / len(renewal_events):.1%})")

    print(f"\nTotal risk-worthy events: {len(all_risky)}")

    if all_risky:
        print("\nDecline code distribution — actual vs section 6.3 target share:")
        code_counts = Counter(e.cause_code for e in all_risky)
        for code, info in sorted(DECLINE_CODES.items(), key=lambda kv: -kv[1].share):
            n = code_counts.get(code, 0)
            actual_share = n / len(all_risky)
            print(f"  {code.value:<22} n={n:>4}  actual={actual_share:>5.1%}  target={info.share:>5.1%}")

        print("\nSelf-recovery rate by decline code — actual vs section 6.3 target:")
        for code, info in sorted(DECLINE_CODES.items(), key=lambda kv: -kv[1].self_recovery_rate):
            code_events = [e for e in all_risky if e.cause_code == code]
            if not code_events:
                continue
            recovered = sum(1 for e in code_events if e.self_recovered)
            print(f"  {code.value:<22} n={len(code_events):>4}  actual={recovered / len(code_events):>5.1%}  target={info.self_recovery_rate:>5.1%}")

        overall_recovered = sum(1 for e in all_risky if e.self_recovered)
        print(f"\nOverall self-recovery rate (no agent, implicit HOLD): {overall_recovered / len(all_risky):.1%}")

        high_self_recovery_share = sum(
            1 for e in all_risky if e.cause_code.value in ("upi_timeout", "bank_downtime")
        ) / len(all_risky)
        print(
            f"upi_timeout + bank_downtime share of volume: {high_self_recovery_share:.1%} "
            "(6.3: 'where the baseline system burns money for nothing')"
        )

    print("=" * 72 + "\n")


if __name__ == "__main__":
    main()
