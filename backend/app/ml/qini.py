"""
Uplift evaluation (section 7.6): Qini curve + coefficient, uplift-at-k, and
policy value. All four operate on a two-arm slice (one action's rows vs the
HOLD/control rows) with a known predicted uplift score per row — the
standard uplift-modelling setup, not something specific to this project.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class QiniPoint:
    fraction: float  # fraction of the population targeted, sorted by descending predicted uplift
    incremental_responders: float  # cumulative treated responders minus control's rate scaled to the same count


def qini_curve(y_true: np.ndarray, treatment: np.ndarray, uplift_score: np.ndarray, n_points: int = 20) -> list[QiniPoint]:
    """
    `treatment[i] = True` means this action was taken on row i; `False` means
    row i is a HOLD/control observation. Rows are ranked by descending
    `uplift_score` and, at each cut-off, we compare cumulative treated
    responders against what the control response rate would predict for the
    same treated count — the standard Qini construction.
    """
    order = np.argsort(-uplift_score)
    y = y_true[order].astype(float)
    t = treatment[order].astype(bool)
    n = len(y)
    if n == 0:
        return []

    cum_t = np.cumsum(t)
    cum_c = np.cumsum(~t)
    cum_r_t = np.cumsum(y * t)
    cum_r_c = np.cumsum(y * (~t))

    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where(cum_c > 0, cum_t / np.maximum(cum_c, 1), 0.0)
    incremental = cum_r_t - cum_r_c * ratio

    fractions = np.arange(1, n + 1) / n
    points = [QiniPoint(fraction=float(fractions[i]), incremental_responders=float(incremental[i])) for i in range(n)]

    if n > n_points:
        idx = np.linspace(0, n - 1, n_points).astype(int)
        points = [points[i] for i in idx]
    return points


def qini_coefficient(points: list[QiniPoint]) -> float:
    """
    Area between the Qini curve and the diagonal "random targeting" line
    (0 at fraction 0, the curve's own endpoint at fraction 1), normalized by
    point count — analogous to the Gini coefficient for a ROC curve. Positive
    means the uplift model ranks better than random targeting.
    """
    if len(points) < 2:
        return 0.0
    fractions = np.array([p.fraction for p in points])
    curve = np.array([p.incremental_responders for p in points])
    random_line = fractions * curve[-1]
    return float(np.trapezoid(curve - random_line, fractions))


def uplift_at_k(y_true: np.ndarray, treatment: np.ndarray, uplift_score: np.ndarray, k: float = 0.2) -> float:
    """
    "If we could only intervene on 20% of events, does the model pick the
    right 20%?" (7.6) — observed uplift (treated response rate minus control
    response rate) within the top-k fraction by predicted uplift.
    """
    order = np.argsort(-uplift_score)
    n_k = max(int(len(y_true) * k), 1)
    idx = order[:n_k]
    y_k, t_k = y_true[idx].astype(bool), treatment[idx].astype(bool)
    t_rate = y_k[t_k].mean() if t_k.any() else 0.0
    c_rate = y_k[~t_k].mean() if (~t_k).any() else 0.0
    return float(t_rate - c_rate)


@dataclass(frozen=True)
class PolicyValueResult:
    policy_net_profit_paise: float
    hold_net_profit_paise: float
    incremental_vs_hold_paise: float


def policy_value_ips(warmup_df: pd.DataFrame, policy_actions: np.ndarray, action_costs_paise: dict[str, float]) -> PolicyValueResult:
    """
    Off-policy evaluation via inverse propensity scoring. Valid here because
    the warm-up dataset (bootstrap_data.py) was collected under a KNOWN
    uniform-random policy over 6 actions (propensity = 1/6 for every row,
    section 6.6) — exactly the condition IPS needs to be unbiased. Real,
    on-policy numbers come from stage 5's live agent loop; this is a first,
    honest estimate from data that already exists.
    """
    n_actions = 6
    propensity = 1.0 / n_actions
    logged_action = warmup_df["action"].to_numpy()
    resolved = warmup_df["resolved"].to_numpy().astype(float)
    value_at_risk = warmup_df["value_at_risk"].to_numpy().astype(float)
    margin_bps = warmup_df["gross_margin_bps"].to_numpy().astype(float)

    gross_gain = resolved * value_at_risk * (margin_bps / 10_000.0)
    cost = np.array([action_costs_paise.get(a, 0.0) for a in logged_action])
    net_profit = gross_gain - cost

    def _ips_mean(mask: np.ndarray) -> float:
        weight = mask.astype(float) / propensity
        return float(np.mean(weight * net_profit))

    policy_net_profit = _ips_mean(logged_action == policy_actions)
    hold_net_profit = _ips_mean(logged_action == "HOLD")

    return PolicyValueResult(
        policy_net_profit_paise=policy_net_profit,
        hold_net_profit_paise=hold_net_profit,
        incremental_vs_hold_paise=policy_net_profit - hold_net_profit,
    )
