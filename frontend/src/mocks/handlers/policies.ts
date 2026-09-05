import { http, HttpResponse } from 'msw'
import {
  PolicyCreateRequestSchema,
  PolicyProposeRequestSchema,
  PolicySimulateRequestSchema,
  PolicyUpdateRequestSchema,
  type Policy,
  type PolicyProposal,
} from '../../api/schemas'
import { API_BASE } from '../apiBase'
import { db, generateId } from '../db'

export const policiesHandlers = [
  http.get(`${API_BASE}/policies`, () => HttpResponse.json(db.policies)),

  // EXTENDED beyond 8.4 — see schemas.ts PolicyCreateRequestSchema.
  http.post(`${API_BASE}/policies`, async ({ request }) => {
    const body = PolicyCreateRequestSchema.parse(await request.json())
    const policy: Policy = { ...body, id: generateId('pol'), enabled: true, authored_by: 'llm_proposal', trigger_count: 0 }
    db.policies.push(policy)
    return HttpResponse.json(policy, { status: 201 })
  }),

  http.put(`${API_BASE}/policies/:id`, async ({ request, params }) => {
    const policy = db.policies.find((p) => p.id === params.id)
    if (!policy) return HttpResponse.json({ error: 'not_found' }, { status: 404 })

    const body = PolicyUpdateRequestSchema.parse(await request.json())
    if (body.enabled !== undefined) policy.enabled = body.enabled
    if (body.rule !== undefined) policy.rule = body.rule

    return HttpResponse.json(policy)
  }),

  // ASSUMED shape — no JSON example in section 8.4 (see schemas.ts PolicyProposalSchema).
  http.post(`${API_BASE}/policies/propose`, async ({ request }) => {
    const body = PolicyProposeRequestSchema.parse(await request.json())
    const proposal: PolicyProposal = {
      name: body.text.length > 60 ? `${body.text.slice(0, 57)}...` : body.text,
      kind: 'hard_block',
      applies_to: ['NUDGE_FREE', 'NUDGE_INCENTIVE'],
      rule: { note: 'Draft rule inferred from free text — review before adding.', source_text: body.text },
      reasoning: `Interpreted "${body.text}" as a hard block on messaging actions. Confirm the applies_to list and rule before adding.`,
    }
    return HttpResponse.json(proposal)
  }),

  http.post(`${API_BASE}/policies/simulate`, async ({ request }) => {
    const body = PolicySimulateRequestSchema.parse(await request.json())
    const blocked_count = Math.max(1, body.policies.length * 7)
    return HttpResponse.json({ blocked_count, net_profit_delta_paise: -blocked_count * 1650 })
  }),
]
