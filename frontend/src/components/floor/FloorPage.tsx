import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRuns } from '../../api/queries'
import { useRunStore } from '../../store/useRunStore'
import { useUiStore } from '../../store/useUiStore'
import { EmptyState, Eyebrow } from '../primitives'
import { DecisionStage } from './DecisionStage'
import { DetectQueue } from './DetectQueue'
import { HoldLedger } from './HoldLedger'
import { ResolvedGrid } from './ResolvedGrid'
import { ScoreStrip } from './ScoreStrip'
import { useFloorStream } from './useFloorStream'

const MAX_RESOLVED_NAVIGABLE = 24 // ResolvedGrid's own MAX_SHOWN — j/k can only reach cards actually on screen

function ColumnHeader({ title }: { title: string }) {
  return (
    <div className="flex flex-col">
      <div className="px-4 py-3">
        <Eyebrow>{title}</Eyebrow>
      </div>
      <div className="h-px w-full bg-rule" />
    </div>
  )
}

const BAND_TONE_CLASSES = {
  // "Paused"/"disconnected" are the amber bands 10.6 names explicitly. "Run
  // complete" isn't described as amber — same call as RunBar's STATUS_TONE:
  // no dedicated "done" colour exists in the 9-token palette, so it stays neutral.
  warn: { border: 'border-warn/30 bg-warn/10', text: 'text-warn' },
  error: { border: 'border-burn/30 bg-burn/10', text: 'text-burn' },
  muted: { border: 'border-rule bg-paper', text: 'text-muted' },
} as const

/** A hairline band under the RunBar, matching 10.6's paused/disconnected/completed states. */
function StatusBand({ tone, text, action }: { tone: keyof typeof BAND_TONE_CLASSES; text: string; action?: { label: string; to: string } }) {
  const classes = BAND_TONE_CLASSES[tone]
  return (
    <div className={`flex h-9 shrink-0 items-center justify-between border-b px-4 ${classes.border}`}>
      <span className={`font-sans text-[13px] ${classes.text}`}>{text}</span>
      {action && (
        <Link to={action.to} className="rounded border border-ink bg-ink px-2.5 py-1 font-sans text-[12px] text-paper">
          {action.label}
        </Link>
      )}
    </div>
  )
}

/** The Floor (section 10.6) — three columns, ScoreStrip, and the four documented run states. */
export function FloorPage() {
  const activeRunId = useRunStore((s) => s.activeRunId)
  const { data: runs } = useRuns()
  const activeRun = runs?.find((r) => r.id === activeRunId) ?? null
  const openCaseSheet = useUiStore((s) => s.openCaseSheet)
  const { detectedItems, resolvedItems, status, marginProtectedPaise, holdCount, heldEntries, runCompleted } = useFloorStream(activeRunId)

  const [resolvedCursor, setResolvedCursor] = useState(0)
  const navigableCount = Math.min(resolvedItems.length, MAX_RESOLVED_NAVIGABLE)

  useEffect(() => {
    if (resolvedCursor >= navigableCount) setResolvedCursor(Math.max(0, navigableCount - 1))
  }, [navigableCount, resolvedCursor])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (navigableCount === 0) return

      if (e.key === 'j') {
        e.preventDefault()
        setResolvedCursor((i) => Math.min(navigableCount - 1, i + 1))
      } else if (e.key === 'k') {
        e.preventDefault()
        setResolvedCursor((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        const item = resolvedItems[resolvedCursor]
        if (item) openCaseSheet(item.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigableCount, resolvedCursor, resolvedItems, openCaseSheet])

  if (!activeRunId || !activeRun) {
    return (
      <EmptyState
        title="No run in progress."
        description="Start one from the World screen."
        action={
          <Link to="/world" className="rounded border border-ink bg-ink px-3 py-1.5 font-sans text-[13px] text-paper">
            Go to World
          </Link>
        }
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {activeRun.status === 'paused' && <StatusBand tone="warn" text={`Paused at sim-day ${activeRun.progress.sim_day}.`} />}
      {status === 'reconnecting' && <StatusBand tone="warn" text="Event stream disconnected. Reconnecting." />}
      {status === 'error' && <StatusBand tone="error" text="Event stream disconnected. Reconnect failed." />}
      {runCompleted && (
        <StatusBand
          tone="muted"
          text={`Run complete. ${activeRun.progress.events_total.toLocaleString('en-IN')} events.`}
          action={{ label: 'See Ledger', to: '/ledger' }}
        />
      )}

      <div className="flex min-h-0 flex-1 border-t border-rule">
        <section className="min-h-0 w-75 shrink-0 border-r border-rule">
          <DetectQueue items={detectedItems} status={status} hasActiveRun={activeRunId !== null} />
        </section>

        <section className="flex min-h-0 flex-1 flex-col border-r border-rule">
          <ColumnHeader title="Decision stage" />
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-6">
              <DecisionStage />
              <ResolvedGrid items={resolvedItems} selectedIndex={resolvedCursor} />
            </div>
          </div>
        </section>

        <section className="flex w-75 shrink-0 flex-col">
          <ColumnHeader title="Hold ledger" />
          <HoldLedger marginProtectedPaise={marginProtectedPaise} holdCount={holdCount} entries={heldEntries} className="flex-1" />
        </section>
      </div>

      <ScoreStrip />
    </div>
  )
}
