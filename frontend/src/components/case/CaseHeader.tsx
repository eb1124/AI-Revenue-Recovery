import type { CaseListItem, RiskEventKind } from '../../api/schemas'
import { formatSimDateTime } from '../../lib/format'
import { Money, Rule } from '../primitives'

const KIND_LABEL: Record<RiskEventKind, string> = {
  abandoned_checkout: 'Abandoned checkout',
  failed_renewal: 'Failed renewal',
}

interface CaseHeaderProps {
  event: CaseListItem
  /** Present only in Sheet mode — the full-page route has no sheet to dismiss. */
  onClose?: () => void
}

/** id + customer name + close, then the one-line context strip (section 10.7 header). */
export function CaseHeader({ event, onClose }: CaseHeaderProps) {
  return (
    <div className="shrink-0">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <span className="truncate font-mono text-[11px] text-faint">{event.id}</span>
        <div className="flex items-center gap-3">
          <span className="font-sans text-[15px] text-ink">{event.customer.display_name}</span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close case file"
              className="font-mono text-[15px] leading-none text-muted hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div className="px-6 pb-4">
        <p className="font-sans text-[13px] text-muted">
          {KIND_LABEL[event.kind]} · <Money paise={event.value_at_risk_paise} size="sm" /> at risk · sim{' '}
          {formatSimDateTime(event.detected_at_sim)}
        </p>
      </div>
      <Rule />
    </div>
  )
}
