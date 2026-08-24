import { runStreamEventSchemas, type RunStreamEventName } from '../schemas'
import type { ConnectionStatus, CreateRunStreamOptions, RunStream, RunStreamHandlers } from './RunStream'
import streamEventsFixture from '../../mocks/fixtures/stream-events.json'

interface StreamEventEnvelope {
  event: RunStreamEventName
  data: unknown
}

const FIXTURE_EVENTS = streamEventsFixture as StreamEventEnvelope[]
const DEFAULT_EVENTS_PER_SECOND = 8
const CONNECT_LATENCY_MS = 150

/**
 * Replays `mocks/fixtures/stream-events.json` on a timer instead of opening
 * a real connection. The fixture is a single scripted run (see
 * scripts/fixtures/stream-events.ts) — `runId` is accepted for interface
 * parity with SseRunStream but doesn't select between multiple fixtures.
 */
export class MockRunStream implements RunStream {
  private handlers: RunStreamHandlers = {}
  private timer: ReturnType<typeof setInterval> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private index = 0
  private eventsPerSecond: number
  private paused = true
  private closed = false
  private started = false

  /** `_runId` accepted for interface parity with SseRunStream; the fixture is a single scripted run, not selected by id. */
  constructor(_runId: string, options?: CreateRunStreamOptions) {
    this.eventsPerSecond = options?.eventsPerSecond ?? DEFAULT_EVENTS_PER_SECOND
  }

  subscribe(handlers: RunStreamHandlers): void {
    this.handlers = handlers
    this.setStatus('connecting')
    this.connectTimer = setTimeout(() => {
      if (this.closed) return
      this.setStatus('open')
      this.started = true
      this.resume()
    }, CONNECT_LATENCY_MS)
  }

  /** Change replay speed. Restarts the interval at the new rate if currently running. */
  setEventsPerSecond(eventsPerSecond: number): void {
    this.eventsPerSecond = Math.max(0.1, eventsPerSecond)
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = setInterval(() => this.tick(), 1000 / this.eventsPerSecond)
    }
  }

  pause(): void {
    this.paused = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  resume(): void {
    if (this.closed || !this.started || !this.paused) return
    if (this.index >= FIXTURE_EVENTS.length) return
    this.paused = false
    this.timer = setInterval(() => this.tick(), 1000 / this.eventsPerSecond)
  }

  close(): void {
    this.closed = true
    if (this.connectTimer) clearTimeout(this.connectTimer)
    this.pause()
    this.setStatus('closed')
  }

  private tick(): void {
    if (this.index >= FIXTURE_EVENTS.length) {
      this.pause()
      return
    }
    const envelope = FIXTURE_EVENTS[this.index]
    this.index += 1
    this.dispatchEnvelope(envelope)
    if (envelope.event === 'run.completed') {
      this.pause()
    }
  }

  private dispatchEnvelope(envelope: StreamEventEnvelope): void {
    const schema = runStreamEventSchemas[envelope.event]
    if (!schema) {
      this.handlers.onError?.(new Error(`Unknown stream event "${envelope.event}"`), envelope)
      return
    }
    const result = schema.safeParse(envelope.data)
    if (!result.success) {
      this.handlers.onError?.(result.error, envelope)
      return
    }
    this.dispatch(envelope.event, result.data)
  }

  private dispatch(eventName: RunStreamEventName, data: unknown): void {
    switch (eventName) {
      case 'run.progress':
        this.handlers.onRunProgress?.(data as never)
        break
      case 'case.detected':
        this.handlers.onCaseDetected?.(data as never)
        break
      case 'case.decided':
        this.handlers.onCaseDecided?.(data as never)
        break
      case 'case.acted':
        this.handlers.onCaseActed?.(data as never)
        break
      case 'case.outcome':
        this.handlers.onCaseOutcome?.(data as never)
        break
      case 'guardrail.blocked':
        this.handlers.onGuardrailBlocked?.(data as never)
        break
      case 'farming.escalated':
        this.handlers.onFarmingEscalated?.(data as never)
        break
      case 'metrics.tick':
        this.handlers.onMetricsTick?.(data as never)
        break
      case 'run.completed':
        this.handlers.onRunCompleted?.(data as never)
        break
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.handlers.onStatusChange?.(status)
  }
}
