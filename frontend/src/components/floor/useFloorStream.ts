import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { get } from '../../api/client'
import type { Action, CaseDecidedEvent, CaseDetectedEvent, RunCompletedEvent } from '../../api/schemas'
import { CaseDetailSchema } from '../../api/schemas'
import { createRunStream, type ConnectionStatus, type RunStream } from '../../api/stream/RunStream'
import type { HeldEntry } from './HoldLedger'
import { useRunStore } from '../../store/useRunStore'

const MAX_DETECTED_RENDERED = 40
const MAX_HELD_ENTRIES_RENDERED = 40

// Real wall-clock receipt time, HH:MM — the stream's case.decided payload
// carries no sim-time field (see CaseDecidedEventSchema), so this is the one
// honest timestamp available for the feed: when the browser actually saw it.
const wallClockFormatter = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })

export interface DetectQueueItem extends CaseDetectedEvent {
  receivedAt: number
}

export interface ResolvedItem {
  id: string
  customerName: string
  isHeld: boolean
  label: 'RECOVERED' | 'LOST'
  resolvedAt: number
}

export interface UseFloorStreamResult {
  detectedItems: DetectQueueItem[]
  resolvedItems: ResolvedItem[]
  status: ConnectionStatus
  /** From the latest metrics.tick — authoritative running totals, not a client-side tally (the dwell/detected queues drop items under load, so they can't be summed for this). */
  marginProtectedPaise: number
  holdCount: number
  heldEntries: HeldEntry[]
  runCompleted: RunCompletedEvent | null
}

/**
 * The ONE stream subscription for the Floor screen. Every column that needs
 * live data (DetectQueue, DecisionStage via the dwell queue, ResolvedGrid)
 * reads from this — none of them opens its own createRunStream() call.
 * MockRunStream replays a single fixed fixture from index 0; two
 * independent subscriptions would each replay it on their own clock and
 * drift out of sync with each other, which is wrong for one live run.
 *
 * `case.decided` events are pushed into useRunStore's dwellQueue (global,
 * since DecisionStage's dwell timing is explicitly documented as that
 * store's job); detected/resolved lists stay local to this hook since only
 * the Floor screen consumes them.
 */
export function useFloorStream(runId: string | null): UseFloorStreamResult {
  const [detectedItems, setDetectedItems] = useState<DetectQueueItem[]>([])
  const [resolvedItems, setResolvedItems] = useState<ResolvedItem[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [marginProtectedPaise, setMarginProtectedPaise] = useState(0)
  const [holdCount, setHoldCount] = useState(0)
  const [heldEntries, setHeldEntries] = useState<HeldEntry[]>([])
  const [runCompleted, setRunCompleted] = useState<RunCompletedEvent | null>(null)
  const enqueueDwellItem = useRunStore((s) => s.enqueueDwellItem)
  const queryClient = useQueryClient()
  const streamRef = useRef<RunStream | null>(null)
  // Bridges case.detected (customer name) and case.decided (action) through
  // to case.outcome, which carries neither — see DetectCard.tsx's note on
  // case.detected's payload shape for the same underlying data gap.
  const caseInfoRef = useRef(new Map<string, { customerName: string; action?: Action }>())

  useEffect(() => {
    setDetectedItems([])
    setResolvedItems([])
    setStatus('connecting')
    setMarginProtectedPaise(0)
    setHoldCount(0)
    setHeldEntries([])
    setRunCompleted(null)
    caseInfoRef.current = new Map()
    if (!runId) return

    let cancelled = false

    createRunStream(runId).then((stream) => {
      if (cancelled) {
        stream.close()
        return
      }
      streamRef.current = stream
      stream.subscribe({
        onStatusChange: setStatus,

        onCaseDetected: (data) => {
          caseInfoRef.current.set(data.id, { customerName: data.customer.display_name })
          setDetectedItems((prev) => [{ ...data, receivedAt: Date.now() }, ...prev].slice(0, MAX_DETECTED_RENDERED))
        },

        onCaseDecided: (data: CaseDecidedEvent) => {
          const existing = caseInfoRef.current.get(data.id)
          const customerName = existing?.customerName ?? data.id
          caseInfoRef.current.set(data.id, { customerName, action: data.action })
          enqueueDwellItem({ event: 'case.decided', data, receivedAt: Date.now() })
          // Prefetch now, at decide-time, not at dequeue-time — DecisionStage
          // dequeues this at least 900ms from now (behind whatever's ahead
          // of it in the queue), which is normally ample lead time for an
          // MSW-backed fetch to finish before it's actually displayed,
          // avoiding a loading flash eating into the visible dwell window.
          void queryClient.prefetchQuery({
            queryKey: ['cases', data.id],
            queryFn: () => get(`/api/cases/${data.id}`, CaseDetailSchema),
          })

          if (data.action === 'HOLD' && data.margin_protected_paise !== null) {
            const entry: HeldEntry = {
              id: data.id,
              time: wallClockFormatter.format(new Date()),
              customerName,
              amountPaise: data.margin_protected_paise,
            }
            setHeldEntries((prev) => [entry, ...prev].slice(0, MAX_HELD_ENTRIES_RENDERED))
          }
        },

        onCaseOutcome: (data) => {
          const info = caseInfoRef.current.get(data.id)
          const isHeld = info?.action === 'HOLD'
          const label = data.resolution_path === 'lost' || data.resolution_path === 'expired' ? 'LOST' : 'RECOVERED'
          setResolvedItems((prev) => [
            { id: data.id, customerName: info?.customerName ?? data.id, isHeld, label, resolvedAt: Date.now() },
            ...prev,
          ])
        },

        onMetricsTick: (data) => {
          setMarginProtectedPaise(data.agent.margin_protected_paise)
          setHoldCount(data.agent.holds)
        },

        onRunCompleted: (data) => {
          setRunCompleted(data)
          setMarginProtectedPaise(data.summary.arms.agent.margin_protected_paise)
          setHoldCount(data.summary.arms.agent.holds)
        },

        onError: (error, raw) => {
          console.warn('[useFloorStream] rejected stream payload', raw.event, error)
        },
      })
    })

    return () => {
      cancelled = true
      streamRef.current?.close()
      streamRef.current = null
    }
  }, [runId, enqueueDwellItem, queryClient])

  return { detectedItems, resolvedItems, status, marginProtectedPaise, holdCount, heldEntries, runCompleted }
}
