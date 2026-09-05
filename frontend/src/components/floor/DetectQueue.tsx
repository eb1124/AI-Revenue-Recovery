import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { cn } from '../../lib/cn'
import type { ConnectionStatus } from '../../api/stream/RunStream'
import { EmptyState, Eyebrow, StatusDot, type StatusTone } from '../primitives'
import { DetectCard } from './DetectCard'
import type { DetectQueueItem } from './useFloorStream'

const ROW_HEIGHT = 96 // card height + gap, fixed since DetectCard content is uniform (name is truncated)

const STREAM_STATUS_TONE: Record<ConnectionStatus, StatusTone> = {
  connecting: 'idle',
  open: 'live',
  reconnecting: 'warn',
  closed: 'idle',
  error: 'error',
}

interface DetectQueueProps {
  items: DetectQueueItem[]
  status: ConnectionStatus
  hasActiveRun: boolean
}

/** Left column — virtualised list of DetectCard, newest at top, max 40 rendered (section 10.6). Fed by useFloorStream, the single shared stream subscription. */
export function DetectQueue({ items, status, hasActiveRun }: DetectQueueProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  })

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Eyebrow>Detected</Eyebrow>
          <StatusDot tone={STREAM_STATUS_TONE[status]} pulse={status === 'open'} />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-faint">{items.length} open</span>
      </div>
      <div className="h-px w-full bg-rule" />

      <div ref={scrollRef} className={cn('min-h-0 flex-1 overflow-y-auto px-3 py-3', items.length === 0 && 'flex items-center justify-center')}>
        {items.length === 0 ? (
          <EmptyState title="No events detected yet." description={hasActiveRun ? 'Waiting for the stream.' : 'No run selected.'} className="py-0" />
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const item = items[virtualRow.index]
              return (
                <div
                  key={item.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="pb-2"
                >
                  <DetectCard event={item} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
