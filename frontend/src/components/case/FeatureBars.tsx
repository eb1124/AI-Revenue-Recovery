import type { TopFeature } from '../../api/schemas'
import { cn } from '../../lib/cn'
import { Eyebrow } from '../primitives'

interface FeatureBarsProps {
  features: TopFeature[]
}

/**
 * Top model features as signed bars off a shared zero line (section 10.7).
 * Ink/muted only — a feature's pull on the score isn't money, so gain/burn
 * (reserved for rupee figures) don't apply here.
 */
export function FeatureBars({ features }: FeatureBarsProps) {
  if (features.length === 0) return null

  const maxAbs = Math.max(1e-6, ...features.map((f) => Math.abs(f.contribution)))

  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>Top features</Eyebrow>
      <div className="flex flex-col gap-1">
        {features.map((f) => {
          const fraction = Math.abs(f.contribution) / maxAbs
          return (
            <div key={f.name} className="flex items-center gap-3">
              <span className="w-44 shrink-0 truncate font-mono text-[11px] text-muted">{f.name}</span>
              <div className="relative h-2 flex-1">
                <div className="absolute inset-y-0 left-1/2 w-px bg-rule" aria-hidden />
                <div
                  className={cn('absolute inset-y-0 rounded-[1px]', f.contribution >= 0 ? 'bg-ink' : 'bg-faint')}
                  style={f.contribution >= 0 ? { left: '50%', width: `${fraction * 50}%` } : { right: '50%', width: `${fraction * 50}%` }}
                />
              </div>
              <span className={cn('w-12 shrink-0 text-right font-mono text-[11px] tabular-nums', f.contribution >= 0 ? 'text-ink' : 'text-muted')}>
                {f.contribution >= 0 ? '+' : ''}
                {f.contribution.toFixed(2)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
