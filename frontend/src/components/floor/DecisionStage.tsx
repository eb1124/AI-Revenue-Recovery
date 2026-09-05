import { useCase } from '../../api/queries'
import type { RiskEventKind } from '../../api/schemas'
import { useUiStore } from '../../store/useUiStore'
import { Card, EmptyState, ErrorState, Money } from '../primitives'
import { DecisionExplanation } from './DecisionExplanation'
import { EVTable } from './EVTable'
import { useDecisionStageDrain } from './useDecisionStageDrain'

const KIND_LABEL: Record<RiskEventKind, string> = {
  abandoned_checkout: 'Abandoned checkout',
  failed_renewal: 'Failed renewal',
}

/** Centre. The case currently being decided, held for a minimum 900ms dwell (section 10.6). */
export function DecisionStage() {
  const caseId = useDecisionStageDrain()
  const { data: caseDetail, isError } = useCase(caseId)
  const openCaseSheet = useUiStore((s) => s.openCaseSheet)

  if (!caseId) {
    return <EmptyState title="Waiting for a decision." description="The next case the agent decides will appear here." />
  }

  if (isError) {
    return <ErrorState title="Couldn't load this case." description="The request failed." />
  }

  if (!caseDetail) {
    return <EmptyState title="Loading case…" />
  }

  const { event, diagnosis, decision } = caseDetail

  return (
    <Card className="flex cursor-pointer flex-col gap-4 hover:border-ink/40" onClick={() => openCaseSheet(caseId)}>
      <div className="flex flex-col gap-0.5">
        <p className="font-sans text-[15px] text-ink">
          {event.customer.display_name} · {event.customer.city}
        </p>
        <p className="flex items-baseline gap-1.5 font-sans text-[13px] text-muted">
          {KIND_LABEL[event.kind]} <Money paise={event.value_at_risk_paise} size="sm" />
        </p>
        <p className="font-mono text-[11px] text-faint">
          {event.cause_code} · conf {diagnosis.confidence.toFixed(2)}
        </p>
      </div>

      <EVTable candidates={caseDetail.candidates} chosenAction={decision.chosen_action} />

      <DecisionExplanation text={decision.explanation} />
    </Card>
  )
}
