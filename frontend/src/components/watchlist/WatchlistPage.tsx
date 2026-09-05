import { useMemo, useState } from 'react'
import { useWatchlist } from '../../api/queries'
import type { FarmingTier, WatchlistEntry } from '../../api/schemas'
import { useRunStore } from '../../store/useRunStore'
import { Badge, DataTable, type DataTableColumn, EmptyState, ErrorState, Money, Sheet } from '../primitives'
import { FarmingDetail } from './FarmingDetail'

const TIER_LABEL: Record<FarmingTier, string> = { normal: 'Normal', watch: 'Watch', flagged: 'Flagged' }

// "Tier badges use --color-warn, never red" (10.9) — these are customers,
// not criminals. Normal gets no emphasis at all.
function tierBadgeTone(tier: FarmingTier): 'warn' | 'muted' {
  return tier === 'normal' ? 'muted' : 'warn'
}

const columns: DataTableColumn<WatchlistEntry>[] = [
  { key: 'customer', header: 'Customer', render: (w) => w.display_name },
  { key: 'tier', header: 'Tier', render: (w) => <Badge tone={tierBadgeTone(w.farming_tier)}>{TIER_LABEL[w.farming_tier]}</Badge> },
  { key: 'score', header: 'Score', numeric: true, render: (w) => w.farming_score.toFixed(2) },
  { key: 'abandons', header: 'Abandons', numeric: true, render: (w) => `${w.abandons}/${w.checkouts_observed}` },
  { key: 'incentives', header: 'Incentives', numeric: true, render: (w) => w.incentives_sent },
  { key: 'extracted', header: 'Extracted', numeric: true, render: (w) => <Money paise={w.incentives_extracted_paise} size="sm" /> },
]

/** Farming detection (section 10.9). Row click opens the FarmingDetail drilldown as a sheet. */
export function WatchlistPage() {
  const activeRunId = useRunStore((s) => s.activeRunId)
  const { data: entries, isLoading, isError } = useWatchlist(activeRunId)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)

  // WatchlistEntry carries no `arm` field, so "what baseline paid vs what
  // HOLD paid" (10.9's illustrative counter) can't be split by arm from
  // this data — this sums the one real, schema-backed number instead of
  // asserting an unverified per-arm split.
  const flaggedExtractedPaise = useMemo(() => (entries ?? []).filter((w) => w.farming_tier === 'flagged').reduce((sum, w) => sum + w.incentives_extracted_paise, 0), [entries])

  if (!activeRunId) {
    return <EmptyState title="No run selected." description="Start one from the World screen." />
  }
  if (isLoading) {
    return <EmptyState title="Loading watchlist…" />
  }
  if (isError) {
    return <ErrorState title="Couldn't load the watchlist." description="The request failed. Try reloading." />
  }
  if (!entries || entries.length === 0) {
    return <EmptyState title="No results yet for this run." description="The watchlist populates once the run completes." />
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pb-6">
      <div className="flex flex-col gap-1 border-b border-rule pb-4">
        <p className="font-sans text-[15px] text-ink">
          <Money paise={flaggedExtractedPaise} size="md" className="text-warn" /> in incentives flagged farmers have extracted this run.
        </p>
        <p className="font-sans text-[13px] text-muted">HOLD's farming defense is what keeps this number from compounding run over run.</p>
      </div>

      <DataTable columns={columns} rows={entries} getRowKey={(w) => w.customer_id} onRowClick={(w) => setSelectedCustomerId(w.customer_id)} />

      <Sheet open={selectedCustomerId !== null} onClose={() => setSelectedCustomerId(null)} widthPx={640}>
        {selectedCustomerId && <FarmingDetail customerId={selectedCustomerId} onClose={() => setSelectedCustomerId(null)} />}
      </Sheet>
    </div>
  )
}
