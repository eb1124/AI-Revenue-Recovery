import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BASE_URL } from '../../api/client'
import { useAuditLog, useRuns, useVerifyAuditChain, type AuditFilters } from '../../api/queries'
import { AuditStageSchema, type AuditEntry, type AuditStage } from '../../api/schemas'
import { cn } from '../../lib/cn'
import { formatSimDateTime } from '../../lib/format'
import { Badge, EmptyState, ErrorState } from '../primitives'

const STAGE_LABEL: Record<AuditStage, string> = {
  detect: 'Detect',
  diagnose: 'Diagnose',
  score: 'Score',
  decide: 'Decide',
  act: 'Act',
  verify: 'Verify',
  policy: 'Policy',
  override: 'Override',
}

const ROW_ESTIMATE = 40 // collapsed row height — expanded rows self-measure (see measureElement below)

async function downloadCsv(filters: AuditFilters) {
  const params = new URLSearchParams()
  if (filters.runId) params.set('run_id', filters.runId)
  if (filters.stage) params.set('stage', filters.stage)
  if (filters.customerId.trim()) params.set('customer_id', filters.customerId.trim())
  if (filters.q.trim()) params.set('q', filters.q.trim())

  const res = await fetch(`${BASE_URL}/api/audit/export.csv?${params.toString()}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'audit.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function AuditRow({ entry, expanded, onToggle }: { entry: AuditEntry; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-rule">
      <div onClick={onToggle} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-paper">
        <span className="w-24 shrink-0 font-mono text-[11px] text-faint">{formatSimDateTime(entry.sim_time)}</span>
        <Badge tone="muted" className="w-20 shrink-0 justify-center">
          {STAGE_LABEL[entry.stage]}
        </Badge>
        <span className="w-16 shrink-0 font-mono text-[11px] text-muted">{entry.actor}</span>
        <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-ink">{entry.summary}</span>
        <span className="w-20 shrink-0 truncate font-mono text-[11px] text-faint">{entry.hash.slice(0, 8)}</span>
      </div>
      {expanded && <pre className="overflow-x-auto bg-paper px-3 py-2 font-mono text-[11px] leading-[1.5] text-ink">{JSON.stringify(entry, null, 2)}</pre>}
    </div>
  )
}

/** The hash-chained log (section 10.12): virtualised infinite table, filters, expandable JSON rows, verify, export. */
export function AuditPage() {
  const [runId, setRunId] = useState<string | null>(null)
  const [stage, setStage] = useState<AuditStage | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [q, setQ] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const filters: AuditFilters = { runId, stage, customerId, q }
  const { data: runs } = useRuns()
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } = useAuditLog(filters)
  const verify = useVerifyAuditChain(runId)

  const items = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: hasNextPage ? items.length + 1 : items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 10,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const lastItem = virtualItems.at(-1)

  useEffect(() => {
    if (lastItem && lastItem.index >= items.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [lastItem, items.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 pt-2">
        <label className="flex flex-col gap-1">
          <span className="font-sans text-[11px] uppercase tracking-[0.09em] text-faint">Run</span>
          <select
            value={runId ?? ''}
            onChange={(e) => setRunId(e.target.value || null)}
            className="rounded border border-rule bg-card px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-ink"
          >
            <option value="">All runs</option>
            {(runs ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-sans text-[11px] uppercase tracking-[0.09em] text-faint">Stage</span>
          <select
            value={stage ?? ''}
            onChange={(e) => setStage((e.target.value || null) as AuditStage | null)}
            className="rounded border border-rule bg-card px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-ink"
          >
            <option value="">All stages</option>
            {AuditStageSchema.options.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-sans text-[11px] uppercase tracking-[0.09em] text-faint">Customer</span>
          <input
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="cus_…"
            className="w-40 rounded border border-rule bg-card px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-ink"
          />
        </label>

        <label className="flex flex-1 flex-col gap-1">
          <span className="font-sans text-[11px] uppercase tracking-[0.09em] text-faint">Free text</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search summary, actor, id…"
            className="w-full rounded border border-rule bg-card px-2 py-1 font-sans text-[13px] text-ink outline-none focus:border-ink"
          />
        </label>

        <button
          type="button"
          onClick={() => verify.mutate()}
          disabled={verify.isPending}
          className="shrink-0 rounded border border-ink bg-ink px-3 py-1.5 font-sans text-[13px] text-paper disabled:opacity-40"
        >
          {verify.isPending ? 'Verifying…' : 'Verify chain'}
        </button>
        <button
          type="button"
          onClick={() => downloadCsv(filters)}
          className="shrink-0 rounded border border-rule px-3 py-1.5 font-sans text-[13px] text-ink hover:bg-paper"
        >
          Export CSV
        </button>
      </div>

      {verify.data && (
        <p className={cn('font-sans text-[13px]', verify.data.intact ? 'text-gain' : 'text-burn')}>
          {verify.data.intact
            ? `${verify.data.entries_checked.toLocaleString('en-IN')} entries, chain intact.`
            : `Broken at entry ${verify.data.broken_at_entry}.`}
        </p>
      )}

      <div className="flex items-center gap-3 border-b border-rule px-3 pb-2 font-sans text-[11px] uppercase tracking-[0.09em] text-faint">
        <span className="w-24 shrink-0">Sim time</span>
        <span className="w-20 shrink-0">Stage</span>
        <span className="w-16 shrink-0">Actor</span>
        <span className="flex-1">Summary</span>
        <span className="w-20 shrink-0">Hash</span>
      </div>

      {isLoading ? (
        <EmptyState title="Loading audit log…" />
      ) : isError ? (
        <ErrorState title="Couldn't load the audit log." description="The request failed. Try reloading." />
      ) : items.length === 0 ? (
        <EmptyState title="No entries match these filters." description="Clear a filter to see more results." />
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((virtualRow) => {
              const isLoaderRow = virtualRow.index >= items.length
              const entry = items[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                >
                  {isLoaderRow ? (
                    <div className="px-3 py-2 font-sans text-[11px] text-faint">Loading more…</div>
                  ) : (
                    <AuditRow entry={entry} expanded={expandedIds.has(entry.id)} onToggle={() => toggleExpanded(entry.id)} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
