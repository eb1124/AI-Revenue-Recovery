import { http, HttpResponse } from 'msw'
import type { AuditEntry } from '../../api/schemas'
import { API_BASE } from '../apiBase'
import { db } from '../db'
import { paginate } from '../pagination'

const GENESIS_HASH = '0'.repeat(64)

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Mirrors the exact object shape (and key order — it matters for
// JSON.stringify) that scripts/fixtures/audit.ts hashed at generation time.
async function recomputeHash(e: AuditEntry): Promise<string> {
  const withoutHash = {
    id: e.id,
    run_id: e.run_id,
    risk_event_id: e.risk_event_id,
    customer_id: e.customer_id,
    stage: e.stage,
    summary: e.summary,
    detail: e.detail,
    actor: e.actor,
    sim_time: e.sim_time,
    wall_time: e.wall_time,
    prev_hash: e.prev_hash,
  }
  return sha256Hex(JSON.stringify(withoutHash))
}

async function verifyChain(entries: AuditEntry[]): Promise<{ intact: boolean; entries_checked: number; broken_at_entry: number | null }> {
  let expectedPrev = GENESIS_HASH
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.prev_hash !== expectedPrev) {
      return { intact: false, entries_checked: i, broken_at_entry: i }
    }
    const recomputed = await recomputeHash(e)
    if (recomputed !== e.hash) {
      return { intact: false, entries_checked: i + 1, broken_at_entry: i }
    }
    expectedPrev = e.hash
  }
  return { intact: true, entries_checked: entries.length, broken_at_entry: null }
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function toCsv(entries: AuditEntry[]): string {
  const header = ['id', 'run_id', 'risk_event_id', 'customer_id', 'stage', 'summary', 'actor', 'sim_time', 'wall_time', 'prev_hash', 'hash']
  const rows = entries.map((e) =>
    [e.id, e.run_id, e.risk_event_id ?? '', e.customer_id ?? '', e.stage, e.summary, e.actor, e.sim_time, e.wall_time, e.prev_hash, e.hash]
      .map((v) => escapeCsv(String(v)))
      .join(','),
  )
  return [header.join(','), ...rows].join('\n')
}

export const auditHandlers = [
  http.get(`${API_BASE}/audit`, ({ request }) => {
    const url = new URL(request.url)
    const runId = url.searchParams.get('run_id')
    const stage = url.searchParams.get('stage')
    const customerId = url.searchParams.get('customer_id')
    // EXTENDED beyond 8.4's documented query params — 10.12 lists "free
    // text" as one of the four filters, but the endpoint spec never names
    // its param. Matches id/summary/actor, same convention as /api/cases's
    // existing `q`.
    const q = url.searchParams.get('q')?.toLowerCase().trim()
    const cursor = url.searchParams.get('cursor')
    const limit = Number(url.searchParams.get('limit') ?? 50)

    let items = db.audit
    if (runId) items = items.filter((a) => a.run_id === runId)
    if (stage) items = items.filter((a) => a.stage === stage)
    if (customerId) items = items.filter((a) => a.customer_id === customerId)
    if (q) {
      items = items.filter((a) => a.id.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q) || a.actor.toLowerCase().includes(q))
    }

    const { items: page, next_cursor } = paginate(items, cursor, limit)
    return HttpResponse.json({ items: page, next_cursor })
  }),

  http.get(`${API_BASE}/audit/verify`, async ({ request }) => {
    const url = new URL(request.url)
    const runId = url.searchParams.get('run_id')
    const entries = runId ? db.audit.filter((a) => a.run_id === runId) : db.audit
    const result = await verifyChain(entries)
    return HttpResponse.json(result)
  }),

  http.get(`${API_BASE}/audit/export.csv`, ({ request }) => {
    const url = new URL(request.url)
    const runId = url.searchParams.get('run_id')
    const stage = url.searchParams.get('stage')
    const customerId = url.searchParams.get('customer_id')
    const q = url.searchParams.get('q')?.toLowerCase().trim()

    // Exports whatever the current filtered view represents, not the whole log.
    let entries = db.audit
    if (runId) entries = entries.filter((a) => a.run_id === runId)
    if (stage) entries = entries.filter((a) => a.stage === stage)
    if (customerId) entries = entries.filter((a) => a.customer_id === customerId)
    if (q) {
      entries = entries.filter((a) => a.id.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q) || a.actor.toLowerCase().includes(q))
    }

    return new HttpResponse(toCsv(entries), { headers: { 'Content-Type': 'text/csv' } })
  }),
]
