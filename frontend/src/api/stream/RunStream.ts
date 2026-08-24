import type {
  CaseActedEvent,
  CaseDecidedEvent,
  CaseDetectedEvent,
  CaseOutcomeEvent,
  FarmingEscalatedEvent,
  GuardrailBlockedEvent,
  MetricsTickEvent,
  RunCompletedEvent,
  RunProgressTick,
} from '../schemas'

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error'

export interface RunStreamHandlers {
  onStatusChange?: (status: ConnectionStatus) => void
  onRunProgress?: (data: RunProgressTick) => void
  onCaseDetected?: (data: CaseDetectedEvent) => void
  onCaseDecided?: (data: CaseDecidedEvent) => void
  onCaseActed?: (data: CaseActedEvent) => void
  onCaseOutcome?: (data: CaseOutcomeEvent) => void
  onGuardrailBlocked?: (data: GuardrailBlockedEvent) => void
  onFarmingEscalated?: (data: FarmingEscalatedEvent) => void
  onMetricsTick?: (data: MetricsTickEvent) => void
  onRunCompleted?: (data: RunCompletedEvent) => void
  /** A payload arrived but failed schema validation (or wasn't valid JSON). Never thrown — surfaced here instead. */
  onError?: (error: unknown, raw: { event: string; data: unknown }) => void
}

/**
 * The one thing every other module is allowed to import from `api/stream/`.
 * Never import SseRunStream or MockRunStream directly outside this file and
 * its own implementation — go through `createRunStream` so swapping the
 * transport (section 10.14 point 5: flip VITE_USE_MOCKS) requires no other
 * code to change.
 */
export interface RunStream {
  /** Registers handlers and begins connecting/replaying. Call once. */
  subscribe(handlers: RunStreamHandlers): void
  /** Stops dispatching events to handlers without tearing down the connection. */
  pause(): void
  /** Resumes dispatching after pause(). */
  resume(): void
  /** Tears down the connection/replay loop. The stream cannot be reused after this. */
  close(): void
}

export interface CreateRunStreamOptions {
  /** MockRunStream only — replay rate. Ignored by SseRunStream. */
  eventsPerSecond?: number
}

/**
 * Async so the two transports can be dynamically imported — a
 * VITE_USE_MOCKS=false build never pulls MockRunStream (and its bundled
 * stream-events.json fixture) into its chunk graph at all.
 */
export async function createRunStream(runId: string, options?: CreateRunStreamOptions): Promise<RunStream> {
  if (import.meta.env.VITE_USE_MOCKS === 'true') {
    const { MockRunStream } = await import('./MockRunStream')
    return new MockRunStream(runId, options)
  }
  const { SseRunStream } = await import('./SseRunStream')
  return new SseRunStream(runId)
}
