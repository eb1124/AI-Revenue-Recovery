import type { RiskEventKind } from '../../api/schemas'
import { useUiStore } from '../../store/useUiStore'
import { Card, Eyebrow, Money } from '../primitives'
import type { DetectQueueItem } from './useFloorStream'

// `case.detected` (section 8.5) doesn't carry cause_code — diagnosis hasn't
// run yet at detect time — so the eyebrow shows the event kind instead of a
// cause. Detection-rule copy is sourced from section 2.4's trigger
// definitions per vertical (the API contract has no per-event
// `detection_rule` string — 5.4 lists the column, 8.4/8.5 never surface it).
const KIND_LABEL: Record<RiskEventKind, string> = {
  abandoned_checkout: 'Abandoned checkout',
  failed_renewal: 'Failed renewal',
}

const DETECTION_RULE_BY_KIND: Record<RiskEventKind, string> = {
  abandoned_checkout: 'Payment initiated, no terminal state after 30 min',
  failed_renewal: 'Card decline or UPI mandate failure on renewal day',
}

interface DetectCardProps {
  event: DetectQueueItem
}

export function DetectCard({ event }: DetectCardProps) {
  const openCaseSheet = useUiStore((s) => s.openCaseSheet)

  return (
    <Card
      className="flex cursor-pointer flex-col gap-1 hover:border-ink/40"
      title={DETECTION_RULE_BY_KIND[event.kind]}
      onClick={() => openCaseSheet(event.id)}
    >
      <Money paise={event.value_at_risk_paise} size="md" />
      <Eyebrow>{KIND_LABEL[event.kind]}</Eyebrow>
      <span className="truncate font-sans text-[13px] text-muted">{event.customer.display_name}</span>
    </Card>
  )
}
