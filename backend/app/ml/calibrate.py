"""
Calibration (section 7.3): "Raw classifier outputs are scores, not
probabilities. The EV equation multiplies them by rupees, so a miscalibrated
model produces confidently wrong money." Isotonic calibration + Brier score +
reliability-diagram data, exactly as 7.3 specifies.
"""

from dataclasses import dataclass

import numpy as np
from sklearn.base import BaseEstimator
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import brier_score_loss


def calibrate(base_estimator: BaseEstimator, cv: int = 5) -> CalibratedClassifierCV:
    """7.3's exact recipe: isotonic calibration, 5-fold cross-validation."""
    return CalibratedClassifierCV(base_estimator, method="isotonic", cv=cv)


def brier_score(y_true: np.ndarray, p_pred: np.ndarray) -> float:
    return float(brier_score_loss(y_true, p_pred))


@dataclass(frozen=True)
class ReliabilityBin:
    bin_low: float
    bin_high: float
    predicted_mean: float | None  # None if the bin is empty
    actual_rate: float | None
    count: int


def reliability_diagram(y_true: np.ndarray, p_pred: np.ndarray, n_bins: int = 10) -> list[ReliabilityBin]:
    """
    Bins predictions into `n_bins` equal-width buckets over [0, 1] and
    compares each bucket's mean predicted probability to its actual observed
    rate — "you point at the diagonal" (7.3). Rendered on the Ledger screen.
    """
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    bins: list[ReliabilityBin] = []
    for i in range(n_bins):
        low, high = edges[i], edges[i + 1]
        in_bin = (p_pred >= low) & (p_pred < high if i < n_bins - 1 else p_pred <= high)
        count = int(in_bin.sum())
        if count == 0:
            bins.append(ReliabilityBin(bin_low=float(low), bin_high=float(high), predicted_mean=None, actual_rate=None, count=0))
            continue
        bins.append(
            ReliabilityBin(
                bin_low=float(low),
                bin_high=float(high),
                predicted_mean=float(p_pred[in_bin].mean()),
                actual_rate=float(y_true[in_bin].mean()),
                count=count,
            )
        )
    return bins


def calibration_error(bins: list[ReliabilityBin]) -> float:
    """Expected calibration error — count-weighted mean |predicted - actual| across non-empty bins."""
    populated = [b for b in bins if b.count > 0]
    total = sum(b.count for b in populated)
    if total == 0:
        return 0.0
    return sum(b.count * abs(b.predicted_mean - b.actual_rate) for b in populated) / total
