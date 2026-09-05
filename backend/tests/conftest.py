"""
Shared fixtures for the six guardrail tests (section 9.5). SQLite, per-test
file DB — same documented fallback stage 1/2 already used
(`DATABASE_URL=sqlite:///...`), set here before `app.db` is imported so the
module-level `engine` picks it up.
"""

import os
from datetime import UTC, datetime
from pathlib import Path

import pytest

_DB_PATH = Path(__file__).parent / "_guardrails_test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_PATH.as_posix()}"

from sqlmodel import Session

from app.db import create_all, engine
from app.models.actions import ActionRecord
from app.models.customers import Customer
from app.models.decisions import Decision
from app.models.enums import (
    Action,
    Arm,
    FarmingTier,
    Language,
    ReasonCode,
    RiskEventKind,
    RunStatus,
    Segment,
    WorldConfigName,
)
from app.models.risk_events import RiskEvent
from app.models.runs import Run, WorldConfig

SIM_NOW = datetime(2026, 8, 15, 12, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _fresh_db():
    if _DB_PATH.exists():
        _DB_PATH.unlink()
    create_all()
    yield
    engine.dispose()
    if _DB_PATH.exists():
        _DB_PATH.unlink()


@pytest.fixture
def session():
    with Session(engine) as s:
        yield s


def make_customer(session: Session, **overrides) -> Customer:
    defaults = {
        "display_name": "Priya Sharma",
        "email": "priya@example.com",
        "phone": "+919812345678",
        "city": "Mumbai",
        "preferred_language": Language.EN,
        "signup_at": datetime(2025, 1, 1, tzinfo=UTC),
        "segment": Segment.REGULAR,
        "gross_margin_bps": 2200,
        "farming_tier": FarmingTier.NORMAL,
        "hard_optout": False,
    }
    defaults.update(overrides)
    customer = Customer(**defaults)
    session.add(customer)
    session.commit()
    session.refresh(customer)
    return customer


def make_world_config(session: Session, **overrides) -> WorldConfig:
    defaults = {"name": WorldConfigName.DEFAULT}
    defaults.update(overrides)
    wc = WorldConfig(**defaults)
    session.add(wc)
    session.commit()
    session.refresh(wc)
    return wc


def make_run(session: Session, **overrides) -> Run:
    world_config = overrides.pop("world_config", None) or make_world_config(session)
    defaults = {"world_config_id": world_config.id, "population_size": 100, "sim_days": 30, "seed": 42, "status": RunStatus.RUNNING}
    defaults.update(overrides)
    run = Run(**defaults)
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


def make_risk_event(session: Session, customer: Customer, run: Run, **overrides) -> RiskEvent:
    defaults = {
        "run_id": run.id,
        "customer_id": customer.id,
        "kind": RiskEventKind.ABANDONED_CHECKOUT,
        "source_id": "cko_placeholder",
        "value_at_risk_paise": 50_000,
        "margin_rate_bps": customer.gross_margin_bps,
        "detected_at_sim": SIM_NOW,
        "detected_at_wall": SIM_NOW,
        "detection_rule": "test-fixture",
        "arm": Arm.AGENT,
    }
    defaults.update(overrides)
    event = RiskEvent(**defaults)
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def make_decision(session: Session, risk_event: RiskEvent, **overrides) -> Decision:
    defaults = {
        "risk_event_id": risk_event.id,
        "chosen_action": Action.RETRY_SCHEDULED,
        "reason_code": ReasonCode.POSITIVE_EV,
        "p_baseline": "0.2200",
        "best_ev_paise": 1000,
        "best_ev_ci_low_paise": 100,
        "best_ev_ci_high_paise": 1900,
        "latency_ms": 5,
        "decided_at_sim": SIM_NOW,
    }
    defaults.update(overrides)
    decision = Decision(**defaults)
    session.add(decision)
    session.commit()
    session.refresh(decision)
    return decision


def make_action(session: Session, decision: Decision, risk_event: RiskEvent, **overrides) -> ActionRecord:
    defaults = {
        "decision_id": decision.id,
        "risk_event_id": risk_event.id,
        "type": Action.RETRY_SCHEDULED,
        "scheduled_for_sim": SIM_NOW,
    }
    defaults.update(overrides)
    action = ActionRecord(**defaults)
    session.add(action)
    session.commit()
    session.refresh(action)
    return action
