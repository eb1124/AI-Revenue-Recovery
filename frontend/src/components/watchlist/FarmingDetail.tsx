import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useWatchlistDetail } from '../../api/queries'
import type { FarmingSignals, FarmingTier, RecentEvent, ResolutionPath, RiskEventKind } from '../../api/schemas'
import { cn } from '../../lib/cn'
import { AXIS_STROKE, TICK_STYLE, TOOLTIP_CONTENT_STYLE, TOOLTIP_LABEL_STYLE, toNumber } from '../../lib/chartTheme'
import { formatSimDate, formatSimDateTime } from '../../lib/format'
import { Badge, EmptyState, ErrorState, Eyebrow, Money, Rule } from '../primitives'

interface FarmingDetailProps {
  customerId: string
  onClose?: () => void
}

const TIER_LABEL: Record<FarmingTier, string> = { normal: 'Normal', watch: 'Watch', flagged: 'Flagged' }

// "Tier badges use --color-warn, never red" (10.9) — these are customers,
// not criminals. Normal gets no emphasis at all.
function tierBadgeTone(tier: FarmingTier): 'warn' | 'muted' {
  return tier === 'normal' ? 'muted' : 'warn'
}

const SIGNAL_LABELS: Record<keyof FarmingSignals, string> = {
  abandon_rate: 'Abandon rate',
  post_incentive_conversion: 'Post-incentive conversion',
  incentive_dependency: 'Incentive dependency',
  timing_regularity: 'Timing regularity',
  stage_consistency: 'Stage consistency',
}

const KIND_LABEL: Record<RiskEventKind, string> = {
  abandoned_checkout: 'Abandoned checkout',
  failed_renewal: 'Failed renewal',
}

const RESOLUTION_TONE: Record<ResolutionPath, 'gain' | 'burn'> = {
  self_recovered: 'gain',
  agent_recovered: 'gain',
  lost: 'burn',
  expired: 'burn',
}

function SignalBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-52 shrink-0 truncate font-sans text-[13px] text-muted">{label}</span>
      <div className="relative h-2 flex-1">
        <div className="absolute inset-0 bg-rule" />
        <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${value * 100}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-[13px] tabular-nums text-ink">{Math.round(value * 100)}%</span>
    </div>
  )
}

function EventRow({ event }: { event: RecentEvent }) {
  const isCutoff = event.action === 'HOLD'
  return (
    <div className={cn('flex flex-col gap-0.5 border-l-2 py-1.5 pl-2', isCutoff ? 'border-hold bg-hold/5' : 'border-transparent')}>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 font-mono text-[11px] text-faint">{formatSimDateTime(event.at)}</span>
        <span className="w-36 shrink-0 truncate font-sans text-[13px] text-ink">{KIND_LABEL[event.kind]}</span>
        <span className={cn('w-28 shrink-0 truncate font-mono text-[11px]', isCutoff ? 'text-hold' : 'text-muted')}>{event.action}</span>
        <Badge tone={RESOLUTION_TONE[event.outcome]} className="shrink-0">
          {event.outcome}
        </Badge>
      </div>
      {/* On its own line rather than squeezed into the row — a fixed-width
          inline slot truncates illegibly once the sheet is narrower than
          ~720px (this one is 640px). */}
      {isCutoff && <p className="font-sans text-[11px] text-hold">HOLD cut them off here — this is the case that stopped the incentive spiral.</p>}
    </div>
  )
}

/**
 * The Watchlist drilldown (section 10.9): score-over-time (the climb is the
 * story), the five signal contributions, and the customer's event history
 * with the HOLD cutoff annotated inline. Rendered inside a Sheet from a
 * Watchlist row click.
 */
export function FarmingDetail({ customerId, onClose }: FarmingDetailProps) {
  const { data, isLoading, isError } = useWatchlistDetail(customerId)

  if (isLoading) return <EmptyState title="Loading…" />
  if (isError || !data) return <ErrorState title="Couldn't load this customer." description="The request failed." />

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="font-sans text-[15px] text-ink">{data.display_name}</span>
          <Badge tone={tierBadgeTone(data.farming_tier)}>{TIER_LABEL[data.farming_tier]}</Badge>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="font-mono text-[15px] leading-none text-muted hover:text-ink">
            ✕
          </button>
        )}
      </div>
      <Rule />

      <div className="flex flex-col gap-6 px-6 py-6">
        <div className="flex flex-col gap-2">
          <Eyebrow>Farming score over time</Eyebrow>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data.score_timeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="at"
                tickFormatter={(v: string) => formatSimDate(v)}
                stroke={AXIS_STROKE}
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={{ stroke: AXIS_STROKE }}
              />
              <YAxis
                domain={[0, 1]}
                tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                stroke={AXIS_STROKE}
                tick={TICK_STYLE}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                contentStyle={TOOLTIP_CONTENT_STYLE}
                labelStyle={TOOLTIP_LABEL_STYLE}
                labelFormatter={(v) => formatSimDate(String(v))}
                formatter={(value) => `${Math.round(toNumber(value) * 100)}%`}
              />
              <Line type="monotone" dataKey="score" stroke="var(--color-warn)" strokeWidth={2} dot={{ r: 2.5, fill: 'var(--color-warn)' }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="flex flex-col gap-2">
          <Eyebrow>Signal contributions</Eyebrow>
          <div className="flex flex-col gap-2">
            {(Object.keys(SIGNAL_LABELS) as (keyof FarmingSignals)[]).map((key) => (
              <SignalBar key={key} label={SIGNAL_LABELS[key]} value={data.farming_signals[key]} />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <Eyebrow>Event history</Eyebrow>
            <span className="font-mono text-[11px] tabular-nums text-faint">
              {data.incentives_sent} incentives sent · <Money paise={data.incentives_extracted_paise} size="xs" /> extracted
            </span>
          </div>
          <div className="flex flex-col">
            {data.events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
