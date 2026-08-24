import type { RunSummary } from '../../src/api/schemas'
import { makeIdFactory } from './ids'

export interface RunsResult {
  runs: RunSummary[]
  completedRunId: string
  completedRunStartedAt: string
  runningRunId: string
  failedRunId: string
}

export function buildRuns(idf: ReturnType<typeof makeIdFactory>): RunsResult {
  const completedRunId = idf('run')
  const runningRunId = idf('run')
  const failedRunId = idf('run')

  const completedRunStartedAt = '2026-08-23T10:14:02Z'

  const runs: RunSummary[] = [
    {
      id: completedRunId,
      status: 'completed',
      arms: ['agent', 'baseline', 'holdout'],
      population_size: 2000,
      sim_days: 30,
      seed: 42,
      progress: { sim_day: 30, total_days: 30, events_processed: 1184, events_total: 1184 },
      started_at: completedRunStartedAt,
      completed_at: '2026-08-23T10:29:41Z',
    },
    {
      id: runningRunId,
      status: 'running',
      arms: ['agent', 'baseline', 'holdout'],
      population_size: 2000,
      sim_days: 30,
      seed: 43,
      progress: { sim_day: 12, total_days: 30, events_processed: 431, events_total: 1180 },
      started_at: '2026-08-24T09:02:17Z',
      completed_at: null,
    },
    {
      id: failedRunId,
      status: 'failed',
      arms: ['agent', 'baseline'],
      population_size: 500,
      sim_days: 14,
      seed: 7,
      progress: { sim_day: 4, total_days: 14, events_processed: 61, events_total: 412 },
      started_at: '2026-08-20T14:00:00Z',
      completed_at: '2026-08-20T14:06:53Z',
    },
  ]

  return { runs, completedRunId, completedRunStartedAt, runningRunId, failedRunId }
}
