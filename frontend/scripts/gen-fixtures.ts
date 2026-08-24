import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CaseDetail, CaseListItem } from '../src/api/schemas'
import { buildAuditChain } from './fixtures/audit'
import { generateBulkCase, randomSimTimestamp } from './fixtures/build'
import { buildCuratedCases } from './fixtures/case-details'
import { makeIdFactory } from './fixtures/ids'
import { buildMetrics } from './fixtures/metrics'
import { buildPolicies } from './fixtures/policies'
import { makeRng, shuffle } from './fixtures/rng'
import { buildRuns } from './fixtures/runs'
import { buildStreamEvents } from './fixtures/stream-events'
import { buildWatchlist } from './fixtures/watchlist'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '..', 'src', 'mocks', 'fixtures')

function writeJson(filename: string, data: unknown) {
  mkdirSync(FIXTURES_DIR, { recursive: true })
  const path = join(FIXTURES_DIR, filename)
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
  console.log(`wrote ${filename}`)
}

function main() {
  const SEED = 42
  const rng = makeRng(SEED)
  const idf = makeIdFactory(rng)

  const rohitId = idf('cus')

  const runsResult = buildRuns(idf)

  const curated = buildCuratedCases(rng, idf, runsResult.completedRunStartedAt, rohitId)

  const bulkCount = 200 - curated.length
  const bulkCases: CaseListItem[] = []
  for (let i = 0; i < bulkCount; i++) {
    const detectedAtSim = randomSimTimestamp(rng, runsResult.completedRunStartedAt, 30)
    bulkCases.push(generateBulkCase(rng, idf, detectedAtSim).item)
  }

  const allCases: CaseListItem[] = shuffle(rng, [...curated.map((c) => c.item), ...bulkCases])

  const caseDetailsById: Record<string, CaseDetail> = {}
  for (const c of curated) caseDetailsById[c.detail.event.id] = c.detail

  const metrics = buildMetrics(rng, runsResult.completedRunId)

  const watchlist = buildWatchlist(rng, idf, { id: rohitId, display_name: 'Rohit Menon' })

  const policies = buildPolicies(idf)

  const audit = buildAuditChain(rng, idf, {
    runId: runsResult.completedRunId,
    startedAtIso: runsResult.completedRunStartedAt,
    windowDays: 30,
    cases: allCases,
    count: 300,
  })

  const streamEvents = buildStreamEvents(rng, idf, {
    runId: runsResult.completedRunId,
    cases: allCases,
    totalEvents: 1184,
    runMetrics: metrics,
    targetLength: 400,
  })

  writeJson('runs.json', runsResult.runs)
  writeJson('cases.json', allCases)
  writeJson('case-details.json', caseDetailsById)
  writeJson('metrics.json', metrics)
  writeJson('watchlist.json', watchlist)
  writeJson('policies.json', policies)
  writeJson('audit.json', audit)
  writeJson('stream-events.json', streamEvents)

  console.log('\nDone. 8 fixture files written to src/mocks/fixtures/.')
}

main()
