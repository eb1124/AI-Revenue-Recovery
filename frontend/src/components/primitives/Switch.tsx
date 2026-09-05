import { cn } from '../../lib/cn'

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  className?: string
}

/** Instant on/off (section 10.10: "Toggling a policy is instant"). No colour beyond ink/rule — this is UI chrome, not a decision. */
export function Switch({ checked, onChange, disabled, label, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
        checked ? 'border-ink bg-ink' : 'border-rule bg-paper',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      <span
        className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-card transition-transform', checked ? 'translate-x-3.5' : 'translate-x-0.5')}
        aria-hidden
      />
    </button>
  )
}
