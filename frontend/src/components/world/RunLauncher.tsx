import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateRun, useCreateWorldConfig } from '../../api/queries'
import { ArmSchema, type Arm, type WorldConfigName, type WorldParams } from '../../api/schemas'
import { cn } from '../../lib/cn'
import { useRunStore } from '../../store/useRunStore'
import { Eyebrow, Rule } from '../primitives'

const PRESETS: { name: WorldConfigName; label: string }[] = [
  { name: 'default', label: 'Default' },
  { name: 'pessimistic', label: 'Pessimistic' },
  { name: 'judge_custom', label: 'Judge custom' },
]

const ARM_LABEL: Record<Arm, string> = { agent: 'Agent', baseline: 'Baseline', holdout: 'Holdout' }

interface RunLauncherProps {
  params: WorldParams
  activePreset: WorldConfigName
  onApplyPreset: (preset: WorldConfigName) => void
}

/**
 * Presets + arms + Start run (section 10.11 bottom bar). Launching saves
 * the current slider state as a WorldConfig, then creates a run against it
 * and hands the active run to the rest of the shell (RunBar/Floor).
 *
 * The spec asks for the Pessimistic run specifically to be pre-computed and
 * cached ("never re-run it live from cold"), with a fixed "+19%" result
 * quoted in its caption. No such pre-computed artifact exists in this
 * project's fixtures, and inventing that number would be exactly the kind
 * of fabrication section 11.2 warns against — so Pessimistic launches a
 * real run through the same path as the others (fast enough against the
 * mock backend to feel instant), and the caption states the mechanism
 * ("every knob set against the agent") without asserting an unverified
 * outcome percentage.
 */
export function RunLauncher({ params, activePreset, onApplyPreset }: RunLauncherProps) {
  const [arms, setArms] = useState<Set<Arm>>(new Set(ArmSchema.options))
  const navigate = useNavigate()
  const setActiveRunId = useRunStore((s) => s.setActiveRunId)
  const createConfig = useCreateWorldConfig()
  const createRun = useCreateRun()

  const isLaunching = createConfig.isPending || createRun.isPending
  const canLaunch = arms.size > 0 && !isLaunching

  function toggleArm(arm: Arm) {
    setArms((prev) => {
      const next = new Set(prev)
      if (next.has(arm)) next.delete(arm)
      else next.add(arm)
      return next
    })
  }

  async function handleStart() {
    const config = await createConfig.mutateAsync({ name: activePreset, params })
    const run = await createRun.mutateAsync({
      world_config_id: config.id,
      arms: ArmSchema.options.filter((arm) => arms.has(arm)),
      population_size: params.population_size,
      sim_days: params.sim_days,
      seed: params.seed,
    })
    setActiveRunId(run.id)
    navigate('/')
  }

  return (
    <div className="flex shrink-0 flex-col gap-4 border-t border-rule pt-6">
      <div className="flex flex-col gap-2">
        <Eyebrow>Presets</Eyebrow>
        <div className="flex items-center gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => onApplyPreset(preset.name)}
              className={cn(
                'rounded border px-2.5 py-1 font-sans text-[13px]',
                activePreset === preset.name ? 'border-ink bg-ink text-paper' : 'border-rule text-muted hover:text-ink',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {activePreset === 'pessimistic' && <p className="font-sans text-[13px] text-muted">Pessimistic sets every assumption against the agent.</p>}
      </div>

      <Rule />

      <div className="flex flex-wrap items-end gap-8">
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Arms</Eyebrow>
          <div className="flex items-center gap-3">
            {ArmSchema.options.map((arm) => (
              <label key={arm} className="flex items-center gap-1.5 font-sans text-[13px] text-ink">
                <input type="checkbox" checked={arms.has(arm)} onChange={() => toggleArm(arm)} />
                {ARM_LABEL[arm]}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Eyebrow>Population</Eyebrow>
          <span className="font-mono text-[15px] tabular-nums text-ink">{params.population_size.toLocaleString('en-IN')}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Sim days</Eyebrow>
          <span className="font-mono text-[15px] tabular-nums text-ink">{params.sim_days}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Seed</Eyebrow>
          <span className="font-mono text-[15px] tabular-nums text-ink">{params.seed}</span>
        </div>

        <button
          type="button"
          onClick={handleStart}
          disabled={!canLaunch}
          className="ml-auto rounded border border-ink bg-ink px-4 py-2 font-sans text-[13px] text-paper disabled:opacity-40"
        >
          {isLaunching ? 'Starting…' : 'Start run'}
        </button>
      </div>

      {(createConfig.isError || createRun.isError) && <p className="font-sans text-[13px] text-burn">Couldn't start the run. Try again.</p>}
    </div>
  )
}
