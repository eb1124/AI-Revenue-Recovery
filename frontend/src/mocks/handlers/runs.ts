import { http, HttpResponse } from 'msw'
import { RunCreateRequestSchema, RunSpeedRequestSchema, type RunDetail, type RunSummary } from '../../api/schemas'
import { API_BASE } from '../apiBase'
import { db, generateId } from '../db'

function toRunDetail(run: RunSummary): RunDetail {
  return { ...run, world_config: db.worldConfigs[0] }
}

export const runsHandlers = [
  http.post(`${API_BASE}/runs`, async ({ request }) => {
    const body = RunCreateRequestSchema.parse(await request.json())
    const now = new Date().toISOString()
    const run: RunSummary = {
      id: generateId('run'),
      status: 'pending',
      arms: body.arms,
      population_size: body.population_size,
      sim_days: body.sim_days,
      seed: body.seed,
      progress: { sim_day: 0, total_days: body.sim_days, events_processed: 0, events_total: 0 },
      started_at: now,
      completed_at: null,
    }
    db.runs.unshift(run)
    return HttpResponse.json(run, { status: 201 })
  }),

  http.get(`${API_BASE}/runs`, () => HttpResponse.json(db.runs)),

  http.get(`${API_BASE}/runs/:runId`, ({ params }) => {
    const run = db.runs.find((r) => r.id === params.runId)
    if (!run) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    return HttpResponse.json(toRunDetail(run))
  }),

  http.post(`${API_BASE}/runs/:runId/pause`, ({ params }) => {
    const run = db.runs.find((r) => r.id === params.runId)
    if (!run) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    run.status = 'paused'
    return HttpResponse.json(toRunDetail(run))
  }),

  http.post(`${API_BASE}/runs/:runId/resume`, ({ params }) => {
    const run = db.runs.find((r) => r.id === params.runId)
    if (!run) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    run.status = 'running'
    return HttpResponse.json(toRunDetail(run))
  }),

  // ASSUMED response shape: section 8.4 lists this endpoint without a "→ X"
  // return type. Mirrors pause/resume (RunDetail) since it's the same
  // family of run-control endpoints and RunSummary has no `speed` field to
  // persist a delta against.
  http.post(`${API_BASE}/runs/:runId/speed`, async ({ request, params }) => {
    RunSpeedRequestSchema.parse(await request.json())
    const run = db.runs.find((r) => r.id === params.runId)
    if (!run) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    return HttpResponse.json(toRunDetail(run))
  }),

  http.get(`${API_BASE}/runs/:runId/summary`, ({ params }) => {
    if (params.runId !== db.metrics.run_id) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    return HttpResponse.json(db.metrics)
  }),
]
