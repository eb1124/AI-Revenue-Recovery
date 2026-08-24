import { http, HttpResponse } from 'msw'
import type { ModelVersion } from '../../api/schemas'
import { API_BASE } from '../apiBase'

// Not one of the 8 requested fixture files — synthesized here from the model
// list in section 7.2 (model A + 5 T-learner arms for model B + model C).
const MODEL_NAMES = [
  'p_baseline',
  'p_recover_retry_now',
  'p_recover_retry_scheduled',
  'p_recover_nudge_free',
  'p_recover_nudge_incentive',
  'p_recover_escalate_human',
  'p_optout',
] as const

const FEATURES = [
  'tenure_days',
  'segment',
  'ltv_expected',
  'gross_margin_bps',
  'abandon_rate_90d',
  'farming_score',
  'days_since_last_purchase',
  'cause_code',
  'cause_confidence',
  'attempt_number',
  'days_to_inferred_salary_day',
  'value_percentile_for_customer',
  'delivery_fee_ratio',
  'gateway_success_rate_1h',
]

function buildModelVersions(): ModelVersion[] {
  return MODEL_NAMES.map((name, i) => ({
    id: `mdl_${name}`,
    name,
    algo: 'hist_gradient_boosting',
    trained_at: '2026-08-23T09:11:00Z',
    train_rows: name === 'p_baseline' ? 1200 : name === 'p_optout' ? 3400 : 800,
    metrics: {
      auc: Math.round((0.78 + i * 0.01) * 1000) / 1000,
      brier_score: Math.round((0.09 - i * 0.003) * 1000) / 1000,
      calibration_error: Math.round((0.02 + i * 0.001) * 1000) / 1000,
    },
    feature_names: FEATURES,
    artifact_path: `models/${name}.joblib`,
  }))
}

export const metricsHandlers = [http.get(`${API_BASE}/metrics/models`, () => HttpResponse.json(buildModelVersions()))]
