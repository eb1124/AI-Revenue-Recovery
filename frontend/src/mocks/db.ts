import type { AuditEntry, CaseDetail, CaseListItem, Policy, RunMetrics, RunSummary, WatchlistEntry, WorldConfig } from '../api/schemas'
import auditFixture from './fixtures/audit.json'
import caseDetailsFixture from './fixtures/case-details.json'
import casesFixture from './fixtures/cases.json'
import metricsFixture from './fixtures/metrics.json'
import policiesFixture from './fixtures/policies.json'
import runsFixture from './fixtures/runs.json'
import watchlistFixture from './fixtures/watchlist.json'

// The default World config (section 6.5) — not part of the generated
// fixtures, since world_configs isn't one of the 8 requested fixture files.
const DEFAULT_WORLD_CONFIG: WorldConfig = {
  id: 'wcf_default000000000000001',
  name: 'default',
  params: {
    salary_timing_lift: 2.4,
    self_recovery_base: 0.3,
    incentive_elasticity: 1.6,
    farmer_share: 0.15,
    farmer_learning_rate: 0.12,
    message_fatigue: 0.4,
    margin_rate_bps: 2200,
    optout_sensitivity: 1.0,
    population_size: 2000,
    sim_days: 30,
    seed: 42,
  },
  created_at: '2026-08-23T10:00:00Z',
}

export interface MockDb {
  runs: RunSummary[]
  cases: CaseListItem[]
  caseDetails: Record<string, CaseDetail>
  metrics: RunMetrics
  watchlist: WatchlistEntry[]
  policies: Policy[]
  audit: AuditEntry[]
  worldConfigs: WorldConfig[]
}

function clone<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createDb(): MockDb {
  return {
    runs: clone(runsFixture) as RunSummary[],
    cases: clone(casesFixture) as CaseListItem[],
    caseDetails: clone(caseDetailsFixture) as Record<string, CaseDetail>,
    metrics: clone(metricsFixture) as RunMetrics,
    watchlist: clone(watchlistFixture) as WatchlistEntry[],
    policies: clone(policiesFixture) as Policy[],
    audit: clone(auditFixture) as AuditEntry[],
    worldConfigs: [clone(DEFAULT_WORLD_CONFIG)],
  }
}

// `let` (not `const`) so resetDb() can swap the whole object out — ES module
// bindings are live, so every module that imported `db` sees the new object.
export let db: MockDb = createDb()

export function resetDb(): void {
  db = createDb()
}

/**
 * The fixtures model a single run's worth of data (cases, watchlist, audit
 * trail all belong to the "completed" run). When a request filters by a
 * different run_id, there's no data to serve for it.
 */
export function completedRunId(): string {
  return db.runs.find((r) => r.status === 'completed')?.id ?? db.runs[0].id
}

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}
