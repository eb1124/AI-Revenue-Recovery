import { useState } from 'react'

interface WorldSliderProps {
  label: string
  /** The one-line "what it attacks" quote/description from section 6.5. */
  attacks: string
  value: number
  defaultValue: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}

/**
 * A single adversarial knob (section 6.5/10.11) — a styled native
 * `<input type="range">`, not a hand-rolled pointer-drag widget, so
 * keyboard arrow/Home/End/PageUp/PageDown support and step-snapping come
 * from the browser for free rather than being reimplemented. The default
 * value gets a tick on the track; the current value shows in mono at rest
 * and in a floating bubble at the thumb while focused (covers both drag and
 * keyboard adjustment, not just mouse drag).
 */
export function WorldSlider({ label, attacks, value, defaultValue, min, max, step, format, onChange }: WorldSliderProps) {
  const [focused, setFocused] = useState(false)
  const pct = ((value - min) / (max - min)) * 100
  const defaultPct = ((defaultValue - min) / (max - min)) * 100

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-sans text-[13px] text-ink">{label}</span>
        <span className="font-mono text-[13px] tabular-nums text-ink">{format(value)}</span>
      </div>

      <div className="relative h-4">
        <div className="pointer-events-none absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 bg-faint" style={{ left: `${defaultPct}%` }} aria-hidden />
        <input
          type="range"
          className="knob-slider absolute top-1/2 left-0 w-full -translate-y-1/2"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label={label}
        />
        {focused && (
          <span
            className="pointer-events-none absolute -top-6 -translate-x-1/2 rounded border border-rule bg-card px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-ink"
            style={{ left: `${pct}%` }}
          >
            {format(value)}
          </span>
        )}
      </div>

      <p className="font-sans text-[11px] text-muted">{attacks}</p>
    </div>
  )
}
