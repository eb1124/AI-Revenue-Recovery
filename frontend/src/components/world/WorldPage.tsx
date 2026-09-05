import { useState } from 'react'
import type { WorldConfigName, WorldParams } from '../../api/schemas'
import { Eyebrow, Rule } from '../primitives'
import { PopulationMixPreview } from './PopulationMixPreview'
import { RunLauncher } from './RunLauncher'
import { WorldSlider } from './WorldSlider'

const DEFAULT_PARAMS: WorldParams = {
  salary_timing_lift: 2.4,
  self_recovery_base: 0.3,
  incentive_elasticity: 1.6,
  farmer_share: 0.15,
  farmer_learning_rate: 0.12,
  message_fatigue: 0.4,
  margin_rate_bps: 2200,
  optout_sensitivity: 1.0,
  population_size: 2000,
  sim_days: 30,
  seed: 42,
}

// "Pessimistic sets every assumption against the agent" (10.11) — each
// adversarial knob pushed to whichever extreme makes its own "what it
// attacks" objection (6.5) literally true: self_recovery_base to its floor
// makes "nobody comes back on their own" true; incentive_elasticity to its
// ceiling makes "discounts work better than you assume" true; and so on.
// population_size/sim_days/seed have no "what it attacks" entry in 6.5 —
// they're scale/reproducibility knobs, not thesis-attacking ones — so they
// stay at default here.
const PESSIMISTIC_PARAMS: WorldParams = {
  ...DEFAULT_PARAMS,
  salary_timing_lift: 1.0,
  self_recovery_base: 0.05,
  incentive_elasticity: 3.0,
  farmer_share: 0.0,
  farmer_learning_rate: 0.0,
  message_fatigue: 0.0,
  margin_rate_bps: 500,
  optout_sensitivity: 0.0,
}

interface SliderDef {
  key: Exclude<keyof WorldParams, 'seed'>
  label: string
  min: number
  max: number
  step: number
  default: number
  attacks: string
  format: (v: number) => string
}

// Straight from the section 6.5 table — default, range, and "what it
// attacks" copied verbatim where the table gives one. `seed` is excluded
// (rendered separately below): its range is "any int", which isn't a
// slider-representable domain.
const SLIDER_DEFS: SliderDef[] = [
  {
    key: 'salary_timing_lift',
    label: 'Salary timing lift',
    min: 1.0,
    max: 4.0,
    step: 0.1,
    default: 2.4,
    attacks: '“Your retry-timing edge is fabricated.”',
    format: (v) => `${v.toFixed(1)}×`,
  },
  {
    key: 'self_recovery_base',
    label: 'Self-recovery base',
    min: 0.05,
    max: 0.7,
    step: 0.01,
    default: 0.3,
    attacks: '“Nobody comes back on their own.”',
    format: (v) => v.toFixed(2),
  },
  {
    key: 'incentive_elasticity',
    label: 'Incentive elasticity',
    min: 1.0,
    max: 3.0,
    step: 0.1,
    default: 1.6,
    attacks: '“Discounts work better than you assume.”',
    format: (v) => `${v.toFixed(1)}×`,
  },
  {
    key: 'farmer_share',
    label: 'Farmer share',
    min: 0.0,
    max: 0.4,
    step: 0.01,
    default: 0.15,
    attacks: '“Farming isn’t real.”',
    format: (v) => v.toFixed(2),
  },
  {
    key: 'farmer_learning_rate',
    label: 'Farmer learning rate',
    min: 0.0,
    max: 0.5,
    step: 0.01,
    default: 0.12,
    attacks: '“Customers don’t adapt that fast.”',
    format: (v) => v.toFixed(2),
  },
  {
    key: 'message_fatigue',
    label: 'Message fatigue',
    min: 0.0,
    max: 1.0,
    step: 0.05,
    default: 0.4,
    attacks: '“Spamming is free.”',
    format: (v) => v.toFixed(2),
  },
  {
    key: 'margin_rate_bps',
    label: 'Margin rate',
    min: 500,
    max: 6000,
    step: 50,
    default: 2200,
    attacks: '“Your margins are unrealistic.”',
    format: (v) => `${Math.round(v)}bps`,
  },
  {
    key: 'optout_sensitivity',
    label: 'Opt-out sensitivity',
    min: 0.0,
    max: 3.0,
    step: 0.1,
    default: 1.0,
    attacks: '“Annoyance costs nothing.”',
    format: (v) => v.toFixed(1),
  },
  {
    key: 'population_size',
    label: 'Population size',
    min: 200,
    max: 20000,
    step: 100,
    default: 2000,
    attacks: 'Scale.',
    format: (v) => Math.round(v).toLocaleString('en-IN'),
  },
  {
    // 6.5's table leaves this row's "what it attacks" cell blank — no
    // judge-objection quote to copy, so this is a plain, honest description
    // of the mechanism instead of an invented objection.
    key: 'sim_days',
    label: 'Sim days',
    min: 7,
    max: 90,
    step: 1,
    default: 30,
    attacks: 'Run length — more days lets self-recovery and farmer adaptation play out.',
    format: (v) => `${Math.round(v)}d`,
  },
]

/** The judge panel (section 10.11) — every 6.5 adversarial knob as a slider, a live population-mix preview, and the run launcher. */
export function WorldPage() {
  const [params, setParams] = useState<WorldParams>(DEFAULT_PARAMS)
  const [activePreset, setActivePreset] = useState<WorldConfigName>('default')

  function setParam(key: keyof WorldParams, value: number) {
    setParams((prev) => ({ ...prev, [key]: value }))
    setActivePreset('judge_custom')
  }

  function applyPreset(preset: WorldConfigName) {
    setActivePreset(preset)
    if (preset === 'default') setParams(DEFAULT_PARAMS)
    else if (preset === 'pessimistic') setParams(PESSIMISTIC_PARAMS)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto pb-6">
      <div className="grid grid-cols-[1fr_320px] gap-10">
        <div className="flex flex-col gap-5">
          <Eyebrow>World parameters</Eyebrow>
          <Rule />
          {SLIDER_DEFS.map((def) => (
            <WorldSlider
              key={def.key}
              label={def.label}
              attacks={def.attacks}
              value={params[def.key]}
              defaultValue={def.default}
              min={def.min}
              max={def.max}
              step={def.step}
              format={def.format}
              onChange={(v) => setParam(def.key, v)}
            />
          ))}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-sans text-[13px] text-ink">Seed</span>
              <input
                type="number"
                value={params.seed}
                onChange={(e) => setParam('seed', Number(e.target.value))}
                className="w-24 rounded border border-rule bg-card px-1.5 py-0.5 text-right font-mono text-[13px] tabular-nums text-ink outline-none focus:border-ink"
              />
            </div>
            {/* Not a slider — "any int" (6.5) has no bounded domain to put a track on. */}
            <p className="font-sans text-[11px] text-muted">Reproducibility. Any integer.</p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <PopulationMixPreview params={params} />
        </div>
      </div>

      <RunLauncher params={params} activePreset={activePreset} onApplyPreset={applyPreset} />
    </div>
  )
}
