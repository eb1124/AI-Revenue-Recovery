import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AuditVerifyResponseSchema,
  CaseDetailSchema,
  CasesListResponseSchema,
  PolicySchema,
  RunDetailSchema,
  RunSummarySchema,
  WatchlistDetailSchema,
  WatchlistEntrySchema,
  WorldSweepResponseSchema,
} from '../api/schemas'
import { API_BASE } from './apiBase'
import { db, resetDb } from './db'
import { handlers } from './handlers'

const server = setupServer(...handlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDb()
})
afterAll(() => server.close())

describe('runs handlers', () => {
  it('lists runs matching RunSummarySchema', async () => {
    const res = await fetch(`${API_BASE}/runs`)
    const body = await res.json()
    for (const run of body) expect(() => RunSummarySchema.parse(run)).not.toThrow()
    expect(body.some((r: { status: string }) => r.status === 'completed')).toBe(true)
  })

  it('returns RunDetail with a world_config for a known run', async () => {
    const runId = db.runs[0].id
    const res = await fetch(`${API_BASE}/runs/${runId}`)
    const body = await res.json()
    expect(RunDetailSchema.parse(body).world_config.name).toBe('default')
  })

  it('pause then resume flips status and persists across requests', async () => {
    const runId = db.runs[0].id
    const paused = await (await fetch(`${API_BASE}/runs/${runId}/pause`, { method: 'POST' })).json()
    expect(paused.status).toBe('paused')
    const refetched = await (await fetch(`${API_BASE}/runs/${runId}`)).json()
    expect(refetched.status).toBe('paused')
    const resumed = await (await fetch(`${API_BASE}/runs/${runId}/resume`, { method: 'POST' })).json()
    expect(resumed.status).toBe('running')
  })
})

describe('cases handlers', () => {
  it('paginates with limit and next_cursor', async () => {
    const res = await fetch(`${API_BASE}/cases?limit=5`)
    const body = CasesListResponseSchema.parse(await res.json())
    expect(body.items).toHaveLength(5)
    expect(body.next_cursor).not.toBeNull()

    const page2 = CasesListResponseSchema.parse(await (await fetch(`${API_BASE}/cases?limit=5&cursor=${body.next_cursor}`)).json())
    expect(page2.items[0].id).not.toBe(body.items[0].id)
  })

  it('filters by cause_code', async () => {
    const res = await fetch(`${API_BASE}/cases?cause=upi_timeout&limit=200`)
    const body = CasesListResponseSchema.parse(await res.json())
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items.every((c) => c.cause_code === 'upi_timeout')).toBe(true)
  })

  it('searches by customer name (q)', async () => {
    const target = db.cases[10]
    const q = target.customer.display_name.split(' ')[0]
    const res = await fetch(`${API_BASE}/cases?q=${encodeURIComponent(q)}&limit=200`)
    const body = CasesListResponseSchema.parse(await res.json())
    expect(body.items.some((c) => c.id === target.id)).toBe(true)
  })

  it('returns an empty page for an unknown run_id', async () => {
    const res = await fetch(`${API_BASE}/cases?run_id=run_doesnotexist`)
    const body = CasesListResponseSchema.parse(await res.json())
    expect(body.items).toHaveLength(0)
  })

  it('serves a curated CaseDetail and a synthesized one, both schema-valid', async () => {
    const curatedId = Object.keys(db.caseDetails)[0]
    const curated = CaseDetailSchema.parse(await (await fetch(`${API_BASE}/cases/${curatedId}`)).json())
    expect(curated.event.id).toBe(curatedId)

    const bulkOnly = db.cases.find((c) => !db.caseDetails[c.id])!
    const synthesized = CaseDetailSchema.parse(await (await fetch(`${API_BASE}/cases/${bulkOnly.id}`)).json())
    expect(synthesized.event.id).toBe(bulkOnly.id)
  })

  it('override updates decided_by and persists on refetch', async () => {
    const item = db.cases.find((c) => c.decision.action === 'HOLD')!
    const res = await fetch(`${API_BASE}/cases/${item.id}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'NUDGE_FREE', params: {}, reason: 'test override' }),
    })
    const body = CaseDetailSchema.parse(await res.json())
    expect(body.decision.chosen_action).toBe('NUDGE_FREE')
    expect(body.decision.decided_by).toBe('human_override')

    const refetched = CaseDetailSchema.parse(await (await fetch(`${API_BASE}/cases/${item.id}`)).json())
    expect(refetched.decision.decided_by).toBe('human_override')
  })

  it('narrative falls back to a synthesized string for bulk cases', async () => {
    const bulkOnly = db.cases.find((c) => !db.caseDetails[c.id])!
    const res = await fetch(`${API_BASE}/cases/${bulkOnly.id}/narrative`)
    const body = await res.json()
    expect(typeof body.narrative).toBe('string')
    expect(body.narrative.length).toBeGreaterThan(0)
  })
})

describe('watchlist handlers', () => {
  it('filters by tier', async () => {
    const res = await fetch(`${API_BASE}/watchlist?tier=flagged`)
    const body = await res.json()
    for (const entry of body) expect(WatchlistEntrySchema.parse(entry).farming_tier).toBe('flagged')
  })

  it('synthesizes a schema-valid WatchlistDetail', async () => {
    const customerId = db.watchlist[0].customer_id
    const res = await fetch(`${API_BASE}/watchlist/${customerId}`)
    const body = WatchlistDetailSchema.parse(await res.json())
    expect(body.score_timeline.length).toBeGreaterThan(0)
  })
})

describe('policies handlers', () => {
  it('PUT toggles enabled and resetDb reverts it', async () => {
    const policy = db.policies[0]
    const res = await fetch(`${API_BASE}/policies/${policy.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(PolicySchema.parse(await res.json()).enabled).toBe(false)

    resetDb()
    const refetched = await (await fetch(`${API_BASE}/policies`)).json()
    expect(refetched.find((p: { id: string }) => p.id === policy.id).enabled).toBe(true)
  })

  it('propose returns a structured proposal', async () => {
    const res = await fetch(`${API_BASE}/policies/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'never contact anyone within 6 hours of a failed delivery' }),
    })
    const body = await res.json()
    expect(body.reasoning).toContain('never contact anyone within 6 hours')
  })
})

describe('world handlers', () => {
  it('sweep returns 200 results with the headline 187 agent_wins', async () => {
    const res = await fetch(`${API_BASE}/world/sweep`)
    const body = WorldSweepResponseSchema.parse(await res.json())
    expect(body.results).toHaveLength(200)
    expect(body.results.filter((r) => r.agent_wins)).toHaveLength(187)
  })
})

describe('audit handlers', () => {
  it('verify reports intact:true on untouched fixture data', async () => {
    const res = await fetch(`${API_BASE}/audit/verify`)
    const body = AuditVerifyResponseSchema.parse(await res.json())
    expect(body.intact).toBe(true)
    expect(body.entries_checked).toBe(db.audit.length)
  })

  it('verify detects tampering', async () => {
    db.audit[150] = { ...db.audit[150], summary: 'TAMPERED' }
    const res = await fetch(`${API_BASE}/audit/verify`)
    const body = AuditVerifyResponseSchema.parse(await res.json())
    expect(body.intact).toBe(false)
    expect(body.broken_at_entry).toBe(150)
  })

  it('exports CSV with a header row', async () => {
    const res = await fetch(`${API_BASE}/audit/export.csv`)
    const text = await res.text()
    expect(text.split('\n')[0]).toBe('id,run_id,risk_event_id,customer_id,stage,summary,actor,sim_time,wall_time,prev_hash,hash')
  })
})

describe('dev handlers', () => {
  it('reset restores mutated state to fixture defaults', async () => {
    const runId = db.runs[0].id
    await fetch(`${API_BASE}/runs/${runId}/pause`, { method: 'POST' })
    expect(db.runs[0].status).toBe('paused')

    const res = await fetch(`${API_BASE}/dev/reset`, { method: 'POST' })
    expect(res.status).toBe(204)
    expect(db.runs.find((r) => r.id === runId)?.status).not.toBe('paused')
  })
})
