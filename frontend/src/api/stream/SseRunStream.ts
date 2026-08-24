import { runStreamEventSchemas, type RunStreamEventName } from '../schemas'
import type { ConnectionStatus, RunStream, RunStreamHandlers } from './RunStream'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 30_000

const EVENT_NAMES = Object.keys(runStreamEventSchemas) as RunStreamEventName[]

/** Real `GET /api/runs/{run_id}/stream` (section 8.5) via native EventSource. */
export class SseRunStream implements RunStream {
  private readonly baseUrl: string
  private handlers: RunStreamHandlers = {}
  private source: EventSource | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private paused = false
  private closed = false

  private readonly runId: string

  constructor(runId: string, baseUrl?: string) {
    this.runId = runId
    this.baseUrl = baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  }

  subscribe(handlers: RunStreamHandlers): void {
    this.handlers = handlers
    this.connect()
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  close(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.source?.close()
    this.source = null
    this.setStatus('closed')
  }

  private connect(): void {
    if (this.closed) return
    this.setStatus(this.retryCount === 0 ? 'connecting' : 'reconnecting')

    const source = new EventSource(`${this.baseUrl}/api/runs/${this.runId}/stream`)
    this.source = source

    source.onopen = () => {
      this.retryCount = 0
      this.setStatus('open')
    }

    for (const eventName of EVENT_NAMES) {
      source.addEventListener(eventName, (event) => {
        this.handleMessage(eventName, (event as MessageEvent<string>).data)
      })
    }

    source.onerror = () => {
      source.close()
      if (this.source === source) this.source = null
      if (this.closed) return
      this.setStatus('error')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.retryCount >= MAX_RETRIES) {
      this.setStatus('closed')
      return
    }
    const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** this.retryCount)
    this.retryCount += 1
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  private handleMessage(eventName: RunStreamEventName, raw: string): void {
    if (this.paused) return

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch (err) {
      this.handlers.onError?.(err, { event: eventName, data: raw })
      return
    }

    const schema = runStreamEventSchemas[eventName]
    const result = schema.safeParse(json)
    if (!result.success) {
      this.handlers.onError?.(result.error, { event: eventName, data: json })
      return
    }

    this.dispatch(eventName, result.data)
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
