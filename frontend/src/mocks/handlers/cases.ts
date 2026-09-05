import { http, HttpResponse } from 'msw'
import { CaseOverrideRequestSchema } from '../../api/schemas'
import { API_BASE } from '../apiBase'
import { completedRunId, db } from '../db'
import { paginate } from '../pagination'
import { synthesizeCaseDetail, synthesizeNarrative } from '../synthesize'

function getOrSynthesizeDetail(id: string) {
  const existing = db.caseDetails[id]
  if (existing) return existing
  const item = db.cases.find((c) => c.id === id)
  if (!item) return undefined
  const synthesized = synthesizeCaseDetail(item)
  db.caseDetails[id] = synthesized // cache so repeat views are stable within the session
  return synthesized
}

export const casesHandlers = [
  http.get(`${API_BASE}/cases`, ({ request }) => {
    const url = new URL(request.url)
    const runId = url.searchParams.get('run_id')
    const arm = url.searchParams.get('arm')
    const status = url.searchParams.get('status')
    const decision = url.searchParams.get('decision')
    const cause = url.searchParams.get('cause')
    const minValue = url.searchParams.get('min_value')
    const q = url.searchParams.get('q')?.toLowerCase().trim()
    const cursor = url.searchParams.get('cursor')
    const limit = Number(url.searchParams.get('limit') ?? 50)

    let items = db.cases
    if (runId && runId !== completedRunId()) items = []
    if (arm) items = items.filter((c) => c.arm === arm)
    if (status) items = items.filter((c) => c.status === status)
    if (decision) items = items.filter((c) => c.decision.action === decision)
    if (cause) items = items.filter((c) => c.cause_code === cause)
    if (minValue) items = items.filter((c) => c.value_at_risk_paise >= Number(minValue))
    if (q) {
      items = items.filter(
        (c) => c.customer.display_name.toLowerCase().includes(q) || c.customer.city.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
      )
    }

    const { items: page, next_cursor } = paginate(items, cursor, limit)
    return HttpResponse.json({ items: page, next_cursor })
  }),

  http.get(`${API_BASE}/cases/:id`, ({ params }) => {
    const detail = getOrSynthesizeDetail(String(params.id))
    if (!detail) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    return HttpResponse.json(detail)
  }),

  http.post(`${API_BASE}/cases/:id/override`, async ({ request, params }) => {
    const id = String(params.id)
    const item = db.cases.find((c) => c.id === id)
    const existing = getOrSynthesizeDetail(id)
    if (!item || !existing) return HttpResponse.json({ error: 'not_found' }, { status: 404 })

    const body = CaseOverrideRequestSchema.parse(await request.json())

    const updated = {
      ...existing,
      decision: {
        ...existing.decision,
        chosen_action: body.action,
        decided_by: 'human_override' as const,
        explanation: body.reason,
      },
      // Section 10.7: "the case re-renders with decided_by: human_override,
      // and a new audit entry appears" — the override is itself an auditable
      // event, on top of whatever detect/diagnose/decide entries exist.
      audit_trail: [
        ...existing.audit_trail,
        {
          stage: 'override' as const,
          summary: `Overridden to ${body.action}: ${body.reason}`,
          sim_time: existing.outcome.resolved_at_sim,
          actor: 'human' as const,
        },
      ],
    }
    db.caseDetails[id] = updated
    item.decision = {
      action: body.action,
      reason_code: existing.decision.reason_code,
      best_ev_paise: item.decision.best_ev_paise,
      margin_protected_paise: body.action === 'HOLD' ? item.decision.margin_protected_paise : 0,
    }

    return HttpResponse.json(updated)
  }),

  http.get(`${API_BASE}/cases/:id/narrative`, ({ params }) => {
    const id = String(params.id)
    const item = db.cases.find((c) => c.id === id)
    if (!item) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    const narrative = db.caseDetails[id]?.diagnosis.narrative ?? synthesizeNarrative(item)
    return HttpResponse.json({ narrative })
  }),
]
