"""
Inference-time helpers (section 7.5) — what stage 5's `agent/score.py` will
call. A "model" here is actually 20 models trained on bootstrap resamples of
the same arm (7.5's "preferred, fast, good enough" option): predicting with
all 20 and taking the 10th/90th percentile gives a confidence interval with
no extra libraries and no assumptions beyond what training already produces.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer

from .features import FEATURE_NAMES, to_feature_row


@dataclass(frozen=True)
class PredictionCI:
    p_mean: float
    ci_low: float  # 10th percentile across the bootstrap ensemble (7.5)
    ci_high: float  # 90th percentile


@dataclass(frozen=True)
class ModelBundle:
    preprocessor: ColumnTransformer
    ensembles: dict[str, list[Any]]  # arm name -> 20 fitted (calibrated) classifiers
    feature_names: list[str]


def load_model_bundle(path: str | Path) -> ModelBundle:
    payload = joblib.load(path)
    return ModelBundle(preprocessor=payload["preprocessor"], ensembles=payload["ensembles"], feature_names=payload["feature_names"])


def _transform_one(bundle: ModelBundle, feature_row: dict) -> np.ndarray:
    frame = pd.DataFrame([feature_row], columns=FEATURE_NAMES)
    return bundle.preprocessor.transform(frame)


def predict_with_ci(bundle: ModelBundle, arm: str, feature_row: dict) -> PredictionCI:
    """
    `arm` is one of "p_baseline", "p_optout", or a non-HOLD Action's `.value`
    (e.g. "NUDGE_FREE"). Single-row convenience wrapper — for scoring many
    events at once (the live loop's batch of a day's new events), use
    `predict_batch_with_ci` instead: `CalibratedClassifierCV.predict_proba`
    carries a large *fixed* per-call overhead (~50ms, independent of row
    count — measured directly, not assumed), so calling this once per event
    for 7 arms x 20 bootstrap models turns into seconds per event. Batching
    pays that fixed cost once per day instead of once per event.
    """
    x = _transform_one(bundle, feature_row)
    probs = np.array([model.predict_proba(x)[0, 1] for model in bundle.ensembles[arm]])
    return PredictionCI(p_mean=float(probs.mean()), ci_low=float(np.percentile(probs, 10)), ci_high=float(np.percentile(probs, 90)))


def predict_from_inputs(bundle: ModelBundle, arm: str, inputs) -> PredictionCI:
    """Convenience wrapper taking a `FeatureInputs` instance instead of a raw dict."""
    return predict_with_ci(bundle, arm, to_feature_row(inputs))


def predict_batch_with_ci(bundle: ModelBundle, arm: str, feature_rows: list[dict]) -> list[PredictionCI]:
    """Same contract as `predict_with_ci`, scored for N rows in one pass — see its docstring for why this exists."""
    if not feature_rows:
        return []
    frame = pd.DataFrame(feature_rows, columns=FEATURE_NAMES)
    x = bundle.preprocessor.transform(frame)
    probs = np.array([model.predict_proba(x)[:, 1] for model in bundle.ensembles[arm]])  # shape (n_models, n_rows)
    means, ci_low, ci_high = probs.mean(axis=0), np.percentile(probs, 10, axis=0), np.percentile(probs, 90, axis=0)
    return [PredictionCI(p_mean=float(means[i]), ci_low=float(ci_low[i]), ci_high=float(ci_high[i])) for i in range(len(feature_rows))]
