import { create } from 'zustand'
import type { RunStreamEventName } from '../api/schemas'

export interface StreamProgress {
  simDay: number
  totalDays: number
  eventsProcessed: number
  eventsTotal: number
  speed: number
}

export interface DwellQueueItem {
  event: RunStreamEventName
  data: unknown
  receivedAt: number
}

const MAX_DWELL_QUEUE = 50

interface RunStoreState {
  /** Which run the shell (RunBar) and Floor screen are watching. */
  activeRunId: string | null
  setActiveRunId: (runId: string | null) => void

  /** Latest `run.progress` SSE payload (section 8.5) — set by whichever screen holds the RunStream subscription. Null until the Floor screen wires it. */
  streamProgress: StreamProgress | null
  setStreamProgress: (progress: StreamProgress) => void

  /**
   * Which case the live stream is currently spotlighting in the Floor's
   * DecisionStage (section 10.6) — distinct from the Case-file sheet, which
   * useUiStore owns, since a case can be spotlighted without its sheet open.
   */
  selectedCaseId: string | null
  setSelectedCaseId: (caseId: string | null) => void

  /**
   * Incoming stream events queued for display at a watchable rate. Section
   * 10.6: at 2880x sim speed the raw event rate is unwatchable, so the
   * Floor screen queues the stream and drains it on a minimum dwell timer
   * rather than rendering every event the instant it arrives.
   */
  dwellQueue: DwellQueueItem[]
  enqueueDwellItem: (item: DwellQueueItem) => void
  dequeueDwellItem: () => void
  clearDwellQueue: () => void
}

export const useRunStore = create<RunStoreState>((set) => ({
  activeRunId: null,
  setActiveRunId: (runId) => set({ activeRunId: runId }),

  streamProgress: null,
  setStreamProgress: (progress) => set({ streamProgress: progress }),

  selectedCaseId: null,
  setSelectedCaseId: (caseId) => set({ selectedCaseId: caseId }),

  dwellQueue: [],
  // Cap 50: if the producer (stream) outpaces the 900ms-per-item consumer
  // (DecisionStage), drop the OLDEST pending items rather than draining
  // faster — the visible pace must stay constant (section 10.6).
  enqueueDwellItem: (item) => set((state) => ({ dwellQueue: [...state.dwellQueue, item].slice(-MAX_DWELL_QUEUE) })),
  dequeueDwellItem: () => set((state) => ({ dwellQueue: state.dwellQueue.slice(1) })),
  clearDwellQueue: () => set({ dwellQueue: [] }),
}))
