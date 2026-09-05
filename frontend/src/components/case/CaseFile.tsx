import type { ResolutionPath, RiskEventKind } from '../../api/schemas'
import { useCase } from '../../api/queries'
import { cn } from '../../lib/cn'
import { Badge, EmptyState, ErrorState, Money, Rule } from '../primitives'
import { AuditStrip } from './AuditStrip'
import { CandidateTable } from './CandidateTable'
import { CaseHeader } from './CaseHeader'
import { DecisionBlock } from './DecisionBlock'
import { EvidenceTable } from './EvidenceTable'
import { FeatureBars } from './FeatureBars'
import { OutcomeBlock } from './OutcomeBlock'
import { StageBlock } from './StageBlock'

// Not part of the API contract (5.4 has a `detection_rule` column, 8.4/8.5
// never surface it) — same gap DetectCard.tsx notes, sourced from 2.4's
// per-vertical trigger definitions instead.
const DETECTION_RULE_BY_KIND: Record<RiskEventKind, string> = {
  abandoned_checkout: 'Payment initiated, no terminal state after 30 min.',
  failed_renewal: 'Card decline or UPI mandate failure on renewal day.',
}

const RESOLUTION_TONE: Record<ResolutionPath, 'gain' | 'burn'> = {
  self_recovered: 'gain',
  agent_recovered: 'gain',
  lost: 'burn',
  expired: 'burn',
}

interface CaseFileProps {
  caseId: string
  /** Present only in Sheet mode. */
  onClose?: () => void
  className?: string
}

/**
 * The full six-stage decision trace (section 10.7) — the shared component
 * behind both the Sheet (opened from the Floor) and the full `/cases/:id`
 * page. Same component, two containers, per the spec.
 */
export function CaseFile({ caseId, onClose, className }: CaseFileProps) {
  const { data, isLoading, isError } = useCase(caseId)

  if (isLoading) {
    return <EmptyState title="Loading case…" className={className} />
  }

  if (isError || !data) {
    return <ErrorState title="Couldn't load this case." description="The case may not exist, or the request failed." className={className} />
  }

  const { event, diagnosis, scoring, candidates, decision, outcome, audit_trail } = data

  return (
    <div className={cn('flex h-full flex-col overflow-y-auto', className)}>
      <CaseHeader event={event} onClose={onClose} />

      <div className="flex flex-col gap-5 px-6 py-6">
        <StageBlock number={1} title="Detected">
          <p className="font-sans text-[13px] text-muted">Rule: {DETECTION_RULE_BY_KIND[event.kind]}</p>
        </StageBlock>

        <Rule />

        <StageBlock
          number={2}
          title="Diagnosed"
          meta={
            <>
              <span className="font-mono text-[11px] text-ink">{diagnosis.cause_code}</span>
              <span className="font-mono text-[11px] text-muted">confidence {diagnosis.confidence.toFixed(2)}</span>
            </>
          }
        >
          {diagnosis.narrative && <p className="font-sans text-[13px] leading-[1.45] text-muted">{diagnosis.narrative}</p>}
          <EvidenceTable evidence={diagnosis.evidence} />
        </StageBlock>

        <Rule />

        <StageBlock
          number={3}
          title="Scored"
          meta={
            <span className="font-mono text-[11px] text-muted">
              p_baseline {scoring.p_baseline.toFixed(2)} · CI [{scoring.p_baseline_ci[0].toFixed(2)}, {scoring.p_baseline_ci[1].toFixed(2)}]
            </span>
          }
        >
          <FeatureBars features={scoring.top_features} />
        </StageBlock>

        <Rule />

        <StageBlock number={4} title="Candidates">
          <CandidateTable candidates={candidates} chosenAction={decision.chosen_action} />
        </StageBlock>

        <Rule />

        <StageBlock
          number={5}
          title="Decided"
          meta={
            <>
              <Badge tone={decision.chosen_action === 'HOLD' ? 'hold' : 'gain'}>{decision.chosen_action}</Badge>
              <span className="font-mono text-[11px] text-muted">{decision.reason_code}</span>
              <span className="font-mono text-[11px] text-faint">{decision.latency_ms}ms</span>
            </>
          }
        >
          <DecisionBlock caseId={caseId} decision={decision} />
        </StageBlock>

        <Rule />

        <StageBlock
          number={6}
          title="Outcome"
          meta={
            <>
              <Badge tone={RESOLUTION_TONE[outcome.resolution_path]}>{outcome.resolution_path}</Badge>
              <Money paise={outcome.net_profit_paise} size="sm" signed />
              <span className="font-mono text-[11px] text-faint">net</span>
            </>
          }
        >
          <OutcomeBlock outcome={outcome} headline={event.headline} />
        </StageBlock>
      </div>

      <Rule />

      <AuditStrip entries={audit_trail} />
    </div>
  )
}
