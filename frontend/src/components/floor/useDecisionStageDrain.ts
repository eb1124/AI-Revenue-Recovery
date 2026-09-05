import { useEffect, useRef, useState } from 'react'
import type { CaseDecidedEvent } from '../../api/schemas'
import { useRunStore } from '../../store/useRunStore'

const MIN_DWELL_MS = 900

/**
 * Drains useRunStore's dwellQueue at a constant, watchable pace: dequeue
 * one item, hold it for at least 900ms, then check the queue again. Never
 * speeds up to "catch up" — if the stream outpaces this, the queue's own
 * 50-item cap (useRunStore) drops the oldest pending items instead.
 */
export function useDecisionStageDrain(): string | null {
  const dwellQueue = useRunStore((s) => s.dwellQueue)
  const dequeueDwellItem = useRunStore((s) => s.dequeueDwellItem)
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const dwellingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (dwellingRef.current) return
    if (dwellQueue.length === 0) return

    // Only case.decided events are ever enqueued (useFloorStream.ts) — safe
    // to narrow the otherwise-generic dwell queue payload here.
    const next = dwellQueue[0].data as CaseDecidedEvent
    dequeueDwellItem()
    setCurrentCaseId(next.id)
    dwellingRef.current = true

    timerRef.current = setTimeout(() => {
      dwellingRef.current = false
      setTick((t) => t + 1) // re-run this effect even if the queue itself didn't change while dwelling
    }, MIN_DWELL_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dwellQueue, dequeueDwellItem, tick])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return currentCaseId
}
