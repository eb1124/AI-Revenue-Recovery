import { useEffect, useState } from 'react'
import { usePauseRun, useResumeRun, useRuns, useSetRunSpeed } from '../../api/queries'
import type { RunStatus } from '../../api/schemas'
import { cn } from '../../lib/cn'
import { useRunStore } from '../../store/useRunStore'
import { StatusDot, type StatusTone } from '../primitives'

const SPEED_OPTIONS = [1, 720, 2880, 8640] as const
const DEFAULT_SPEED = 2880

// No dedicated "done" tone exists (nine-colour palette, section 10.2) —
// completed reuses the quiet `idle` tone rather than inventing one.
// `paused` uses `warn`, matching the amber "Paused at sim-day N" band
// documented for the Floor screen (section 10.6).
const STATUS_TONE: Record<RunStatus, StatusTone> = {
  running: 'live',
  paused: 'warn',
  pending: 'idle',
  completed: 'idle',
  failed: 'error',
}

/** Run id, status dot, pause/resume, speed selector, sim-day progress (section 10.6). Sticky top. */
export function RunBar() {
  const { data: runs } = useRuns()
  const activeRunId = useRunStore((s) => s.activeRunId)
  const setActiveRunId = useRunStore((s) => s.setActiveRunId)
  const streamSpeed = useRunStore((s) => s.streamProgress?.speed)

  // No run is pre-selected anywhere yet (the Floor screen — the natural
  // place to choose one — is still a placeholder), so default to the most
  // relevant run on first load: prefer one already running, else pending,
  // paused, completed, failed, in that order.
  useEffect(() => {
    if (activeRunId || !runs || runs.length === 0) return
    const byPreference = (['running', 'pending', 'paused', 'completed', 'failed'] as const)
      .map((status) => runs.find((r) => r.status === status))
      .find((r) => r !== undefined)
    setActiveRunId((byPreference ?? runs[0]).id)
  }, [runs, activeRunId, setActiveRunId])

  const activeRun = runs?.find((r) => r.id === activeRunId) ?? null

  const pauseRun = usePauseRun()
  const resumeRun = useResumeRun()
  const setSpeed = useSetRunSpeed()

  // Speed isn't part of the REST run resource (see api/queries.ts) — only
  // the live SSE stream carries it. Fall back to the last speed clicked
  // here until a screen wires that stream into useRunStore.
  const [localSpeed, setLocalSpeed] = useState<number>(DEFAULT_SPEED)
  const currentSpeed = streamSpeed ?? localSpeed

  if (!activeRun) {
    return (
      <div className="flex h-10 items-center border-b border-rule px-6">
        <span className="font-sans text-[13px] text-muted">No run selected. Start one from the World screen.</span>
      </div>
    )
  }

  const isPaused = activeRun.status === 'paused'
  const canToggle = activeRun.status === 'running' || isPaused
  const isMutating = pauseRun.isPending || resumeRun.isPending
  const { progress } = activeRun
  const progressPct = progress.total_days > 0 ? Math.min(100, Math.round((progress.sim_day / progress.total_days) * 100)) : 0

  return (
    <div className="flex h-10 items-center gap-6 border-b border-rule px-6">
      <div className="flex items-center gap-2">
        <StatusDot tone={STATUS_TONE[activeRun.status]} pulse={activeRun.status === 'running'} />
        <span className="font-mono text-[13px] text-ink">{activeRun.id}</span>
      </div>

      <button
        type="button"
        disabled={!canToggle || isMutating}
        onClick={() => (isPaused ? resumeRun.mutate(activeRun.id) : pauseRun.mutate(activeRun.id))}
        className={cn(
          'rounded border border-rule px-2 py-1 font-sans text-[11px] uppercase tracking-[0.04em] text-ink',
          !canToggle || isMutating ? 'cursor-not-allowed opacity-40' : 'hover:bg-card',
        )}
      >
        {isPaused ? 'Resume' : 'Pause'}
      </button>

      <div className="flex items-center gap-1">
        {SPEED_OPTIONS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => {
              setLocalSpeed(speed)
              setSpeed.mutate({ runId: activeRun.id, speed })
            }}
            className={cn(
              'rounded border px-1.5 py-0.5 font-mono text-[11px] tabular-nums',
              speed === currentSpeed ? 'border-ink bg-ink text-paper' : 'border-rule text-muted hover:text-ink',
            )}
          >
            {speed}×
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="font-mono text-[13px] tabular-nums text-muted">
          sim-day {progress.sim_day}/{progress.total_days}
        </span>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-rule">
          <div className="h-full bg-ink" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-faint">
          {progress.events_processed}/{progress.events_total} events
        </span>
      </div>
    </div>
  )
}
