"""
Trains models A, B, C (section 7.2) on the warm-up dataset (6.6,
bootstrap_data.py), calibrates each with isotonic regression (7.3), and
fits a 20-model bootstrap ensemble per arm for confidence intervals (7.5).
Evaluates with AUC / Brier / calibration error and Qini for the five B arms
(7.6), saves one joblib artifact, and writes a ModelVersion row per arm.

Standalone-runnable, same pattern as sim/run.py:

    python -m app.ml.train --seed 42
"""

import argparse
import random
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import OneHotEncoder
from sqlmodel import Session

from app.agent.costs import ACTION_DIRECT_COST_PAISE
from app.db import create_all, engine
from app.models.enums import Action
from app.models.ml import ModelVersion
from app.sim.world_params import WorldParams

from .bootstrap_data import generate_warmup_dataset
from .calibrate import brier_score, calibrate, calibration_error, reliability_diagram
from .features import CATEGORICAL_FEATURES, FEATURE_NAMES, NUMERIC_FEATURES
from .qini import policy_value_ips, qini_coefficient, qini_curve, uplift_at_k

SIM_START = datetime(2026, 8, 1, tzinfo=UTC)  # matches sim/run.py's live-phase start; warmup runs before this (6.6)
ARTIFACT_DIR = Path(__file__).parent / "artifacts"
BOOTSTRAP_N = 20  # 7.5's ensemble size

NON_HOLD_ACTIONS = [a for a in Action if a != Action.HOLD]

# String-keyed mirror of the shared action-cost table (app/agent/costs.py) —
# this module works with pandas string columns (df["action"]), not the enum.
# NUDGE_INCENTIVE's discount itself isn't modelled here since incentive
# sizing is a second-stage decision made *after* the action type is chosen
# (4.6), which needs a live decision loop (stage 5) this warm-up pass doesn't have.
ACTION_COSTS_PAISE = {action.value: cost for action, cost in ACTION_DIRECT_COST_PAISE.items()}


def _build_preprocessor() -> ColumnTransformer:
    return ColumnTransformer(
        [
            ("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL_FEATURES),
            ("num", SimpleImputer(strategy="median"), NUMERIC_FEATURES),
        ]
    )


def _safe_cv(y: np.ndarray, max_cv: int = 5) -> int | None:
    """None means: too little class balance in this resample to cross-validate — skip calibration for it."""
    counts = np.bincount(y.astype(int))
    if len(counts) < 2 or counts.min() < 2:
        return None
    return max(2, min(max_cv, int(counts.min())))


def _bootstrap_ensemble(X: np.ndarray, y: np.ndarray, rng: np.random.Generator, n: int) -> list:
    models = []
    n_rows = len(y)
    for _ in range(n):
        idx = rng.integers(0, n_rows, size=n_rows)
        x_b, y_b = X[idx], y[idx]
        seed = int(rng.integers(0, 2**31 - 1))
        base = HistGradientBoostingClassifier(max_iter=150, random_state=seed)
        cv = _safe_cv(y_b)
        model = calibrate(base, cv=cv).fit(x_b, y_b) if cv is not None else base.fit(x_b, y_b)
        models.append(model)
    return models


def _ensemble_mean_proba(models: list, X: np.ndarray) -> np.ndarray:
    return np.mean([m.predict_proba(X)[:, 1] for m in models], axis=0)


def _evaluate_binary(models: list, X: np.ndarray, y: np.ndarray) -> dict:
    mean_pred = _ensemble_mean_proba(models, X)
    try:
        auc = float(roc_auc_score(y, mean_pred))
    except ValueError:
        auc = float("nan")  # only one class present in this eval slice — too few positives to rank
    bins = reliability_diagram(y, mean_pred)
    return {
        "auc": auc,
        "brier": brier_score(y, mean_pred),
        "calibration_error": calibration_error(bins),
        "n": len(y),
        "positive_rate": float(y.mean()) if len(y) else 0.0,
    }


def train_all(params: WorldParams, warmup_days: int, bootstrap_n: int, rng_seed: int) -> dict:
    py_rng = random.Random(rng_seed)
    np_rng = np.random.default_rng(rng_seed)

    df = generate_warmup_dataset(params, SIM_START, warmup_days, py_rng)
    print(f"Warm-up dataset: {len(df)} labelled events")
    print(df["action"].value_counts().to_string())

    order = np_rng.permutation(len(df))
    split = int(len(df) * 0.8)
    train_df = df.iloc[order[:split]].reset_index(drop=True)
    test_df = df.iloc[order[split:]].reset_index(drop=True)

    preprocessor = _build_preprocessor()
    preprocessor.fit(train_df[FEATURE_NAMES])
    x_train_all = preprocessor.transform(train_df[FEATURE_NAMES])
    x_test_all = preprocessor.transform(test_df[FEATURE_NAMES])

    ensembles: dict[str, list] = {}
    metrics: dict[str, dict] = {}
    train_rows: dict[str, int] = {}

    # --- Model A: p_baseline, HOLD/holdout-arm rows only (7.2) -------------
    mask_train = (train_df["action"] == "HOLD").to_numpy()
    mask_test = (test_df["action"] == "HOLD").to_numpy()
    y_train = train_df.loc[mask_train, "resolved"].to_numpy()
    ensembles["p_baseline"] = _bootstrap_ensemble(x_train_all[mask_train], y_train, np_rng, bootstrap_n)
    metrics["p_baseline"] = _evaluate_binary(ensembles["p_baseline"], x_test_all[mask_test], test_df.loc[mask_test, "resolved"].to_numpy())
    train_rows["p_baseline"] = int(mask_train.sum())
    print(f"\n[A] p_baseline        n_train={train_rows['p_baseline']:>5}  AUC={metrics['p_baseline']['auc']:.3f}  Brier={metrics['p_baseline']['brier']:.4f}")

    # --- Model B: p_recover[a], one model per non-HOLD action (T-learner, 7.2) ---
    for action in NON_HOLD_ACTIONS:
        arm = action.value
        mask_train = (train_df["action"] == arm).to_numpy()
        mask_test = (test_df["action"] == arm).to_numpy()
        y_train = train_df.loc[mask_train, "resolved"].to_numpy()
        ensembles[arm] = _bootstrap_ensemble(x_train_all[mask_train], y_train, np_rng, bootstrap_n)
        metrics[arm] = _evaluate_binary(ensembles[arm], x_test_all[mask_test], test_df.loc[mask_test, "resolved"].to_numpy())
        train_rows[arm] = int(mask_train.sum())
        print(f"[B] p_recover[{arm:<16}] n_train={train_rows[arm]:>5}  AUC={metrics[arm]['auc']:.3f}  Brier={metrics[arm]['brier']:.4f}")

    # --- Model C: p_optout, all contacted events (7.2) ----------------------
    mask_train = (train_df["action"] != "HOLD").to_numpy()
    mask_test = (test_df["action"] != "HOLD").to_numpy()
    y_train = train_df.loc[mask_train, "opted_out"].to_numpy()
    ensembles["p_optout"] = _bootstrap_ensemble(x_train_all[mask_train], y_train, np_rng, bootstrap_n)
    metrics["p_optout"] = _evaluate_binary(ensembles["p_optout"], x_test_all[mask_test], test_df.loc[mask_test, "opted_out"].to_numpy())
    train_rows["p_optout"] = int(mask_train.sum())
    optout_rate = float(y_train.mean()) if len(y_train) else 0.0
    print(
        f"[C] p_optout          n_train={train_rows['p_optout']:>5}  AUC={metrics['p_optout']['auc']:.3f}  "
        f"Brier={metrics['p_optout']['brier']:.4f}  (base opt-out rate {optout_rate:.1%} — AUC is noisy this close to zero)"
    )

    # --- Qini per B-arm: that arm's test rows + the HOLD control test rows (7.6) ---
    print("\nUplift evaluation (Qini, vs HOLD control):")
    qini_results: dict[str, dict] = {}
    for action in NON_HOLD_ACTIONS:
        arm = action.value
        subset_mask = test_df["action"].isin([arm, "HOLD"]).to_numpy()
        subset = test_df[subset_mask]
        x_subset = preprocessor.transform(subset[FEATURE_NAMES])
        p_arm = _ensemble_mean_proba(ensembles[arm], x_subset)
        p_base = _ensemble_mean_proba(ensembles["p_baseline"], x_subset)
        uplift_score = p_arm - p_base
        y_true = subset["resolved"].to_numpy()
        treatment = (subset["action"] == arm).to_numpy()

        curve = qini_curve(y_true, treatment, uplift_score)
        coefficient = qini_coefficient(curve)
        u_at_20 = uplift_at_k(y_true, treatment, uplift_score, k=0.2)
        qini_results[arm] = {"qini_coefficient": coefficient, "uplift_at_20pct": u_at_20, "n": int(subset_mask.sum())}
        print(f"  {arm:<18} qini={coefficient:+.3f}  uplift@20%={u_at_20:+.3f}  n={qini_results[arm]['n']}")
        metrics[arm]["qini_coefficient"] = coefficient
        metrics[arm]["uplift_at_20pct"] = u_at_20

    # --- Policy value: EV-greedy action per test row vs always-HOLD (IPS, 7.6) ---
    value_at_risk_all = test_df["value_at_risk"].to_numpy(dtype=float)
    margin_all = test_df["gross_margin_bps"].to_numpy(dtype=float)
    p_base_all = _ensemble_mean_proba(ensembles["p_baseline"], x_test_all)

    ev_columns = [np.zeros(len(test_df))]  # HOLD's EV is exactly 0 by construction (4.2)
    action_order = ["HOLD"]
    for action in NON_HOLD_ACTIONS:
        arm = action.value
        p_arm_all = _ensemble_mean_proba(ensembles[arm], x_test_all)
        uplift = p_arm_all - p_base_all
        gross_gain = uplift * value_at_risk_all * (margin_all / 10_000.0)
        ev_columns.append(gross_gain - ACTION_COSTS_PAISE[arm])
        action_order.append(arm)

    ev_matrix = np.column_stack(ev_columns)
    best_actions = np.array(action_order)[ev_matrix.argmax(axis=1)]
    policy_result = policy_value_ips(test_df, best_actions, ACTION_COSTS_PAISE)
    print(
        f"\nPolicy value (off-policy IPS estimate, per event): "
        f"model-policy={policy_result.policy_net_profit_paise:.1f}p  "
        f"HOLD-only={policy_result.hold_net_profit_paise:.1f}p  "
        f"incremental={policy_result.incremental_vs_hold_paise:+.1f}p"
    )

    return {
        "preprocessor": preprocessor,
        "ensembles": ensembles,
        "metrics": metrics,
        "qini_results": qini_results,
        "train_rows": train_rows,
        "policy_result": policy_result,
    }


def save_artifacts(result: dict) -> str:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    path = ARTIFACT_DIR / "hold_models.joblib"
    # 140 boosted-tree models (7 arms x 20 bootstrap resamples, each an
    # isotonic-calibrated CalibratedClassifierCV with its own internal CV
    # clones) adds up fast uncompressed — compress=3 trades a bit of
    # save/load CPU for a much smaller artifact stage 5's API will load.
    joblib.dump({"preprocessor": result["preprocessor"], "ensembles": result["ensembles"], "feature_names": FEATURE_NAMES}, path, compress=3)
    return str(path)


def persist_model_versions(result: dict, artifact_path: str) -> None:
    create_all()
    now = datetime.now(UTC)
    with Session(engine) as session:
        for arm, metrics in result["metrics"].items():
            name = f"p_recover_{arm.lower()}" if arm not in ("p_baseline", "p_optout") else arm
            session.add(
                ModelVersion(
                    name=name,
                    algo="hist_gradient_boosting",
                    trained_at=now,
                    train_rows=result["train_rows"][arm],
                    metrics={k: v for k, v in metrics.items() if isinstance(v, (int, float))},
                    feature_names=FEATURE_NAMES,
                    artifact_path=artifact_path,
                )
            )
        session.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train models A/B/C on the warm-up dataset and print evaluation metrics.")
    parser.add_argument("--seed", type=int, default=42)
    # Independent of WorldParams.population_size's own default (2000, 6.5) —
    # this is a training-dataset-size choice, tuned so the default warm-up
    # run lands close to 6.6's "roughly 4,000 labelled events" (~1,924 at
    # population=2000, ~4,000 here) and 7.2's "~800 rows per B arm".
    parser.add_argument("--population", type=int, default=4200)
    parser.add_argument("--warmup-days", type=int, default=60)
    parser.add_argument("--bootstrap-n", type=int, default=BOOTSTRAP_N)
    args = parser.parse_args()

    params = WorldParams(seed=args.seed, population_size=args.population)
    print("=" * 72)
    print(f"HOLD ML PIPELINE — seed={args.seed}  population={args.population}  warmup_days={args.warmup_days}")
    print("=" * 72)

    result = train_all(params, args.warmup_days, args.bootstrap_n, args.seed)
    artifact_path = save_artifacts(result)
    persist_model_versions(result, artifact_path)
    print(f"\nSaved artifact: {artifact_path}")
    print("=" * 72)


if __name__ == "__main__":
    main()
