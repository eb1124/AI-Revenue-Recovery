import type { WorldParams } from '../../api/schemas'
import { Eyebrow } from '../primitives'

// Section 6.2's fixed generator mix (self-recoverer 30% / genuinely stuck
// 35% / price sensitive 20% / farmer 15%). Only `farmer_share` is an actual
// population-share knob (6.5); the other three are rescaled proportionally
// to fill whatever share farmers don't take.
const BASE_SELF_RECOVERER = 0.3
const BASE_STUCK = 0.35
const BASE_PRICE_SENSITIVE = 0.2
const BASE_NON_FARMER_TOTAL = BASE_SELF_RECOVERER + BASE_STUCK + BASE_PRICE_SENSITIVE // 0.85

interface PopulationMixPreviewProps {
  params: WorldParams
}

interface Archetype {
  name: string
  share: number
  colorVar: string
}

/**
 * The live population-mix preview (section 10.11 right side). Deliberately
 * driven by `farmer_share` alone — it's the only slider that controls a
 * population *share*; the other adversarial knobs (self_recovery_base,
 * message_fatigue, ...) change customer *behaviour*, not archetype
 * headcount, so moving them shouldn't move this chart.
 */
export function PopulationMixPreview({ params }: PopulationMixPreviewProps) {
  const farmerShare = params.farmer_share
  const nonFarmer = 1 - farmerShare

  const archetypes: Archetype[] = [
    { name: 'Genuinely stuck', share: (BASE_STUCK / BASE_NON_FARMER_TOTAL) * nonFarmer, colorVar: 'var(--color-ink)' },
    { name: 'Self-recoverer', share: (BASE_SELF_RECOVERER / BASE_NON_FARMER_TOTAL) * nonFarmer, colorVar: 'color-mix(in srgb, var(--color-ink) 62%, transparent)' },
    { name: 'Price sensitive', share: (BASE_PRICE_SENSITIVE / BASE_NON_FARMER_TOTAL) * nonFarmer, colorVar: 'color-mix(in srgb, var(--color-ink) 30%, transparent)' },
    { name: 'Farmer', share: farmerShare, colorVar: 'var(--color-warn)' },
  ]

  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Population mix</Eyebrow>

      <div className="flex h-4 w-full overflow-hidden">
        {archetypes.map((a) => (
          <div key={a.name} style={{ width: `${a.share * 100}%`, background: a.colorVar }} title={`${a.name} ${(a.share * 100).toFixed(0)}%`} />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {archetypes.map((a) => (
          <div key={a.name} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0" style={{ background: a.colorVar }} aria-hidden />
            <span className="flex-1 font-sans text-[13px] text-muted">{a.name}</span>
            <span className="font-mono text-[13px] tabular-nums text-ink">{(a.share * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      <p className="font-sans text-[11px] text-faint">Only farmer share moves this — the other knobs change behaviour, not headcount.</p>
    </div>
  )
}
