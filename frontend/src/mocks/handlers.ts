import { auditHandlers } from './handlers/audit'
import { casesHandlers } from './handlers/cases'
import { devHandlers } from './handlers/dev'
import { metricsHandlers } from './handlers/metrics'
import { policiesHandlers } from './handlers/policies'
import { runsHandlers } from './handlers/runs'
import { watchlistHandlers } from './handlers/watchlist'
import { worldHandlers } from './handlers/world'

// Every GET/POST/PUT endpoint in section 8.4 except the SSE stream
// (GET /api/runs/{run_id}/stream — see src/api/stream/) and DELETE
// /api/runs/{run_id} (out of scope per this task's brief).
export const handlers = [
  ...runsHandlers,
  ...casesHandlers,
  ...watchlistHandlers,
  ...policiesHandlers,
  ...worldHandlers,
  ...auditHandlers,
  ...metricsHandlers,
  ...devHandlers,
]
