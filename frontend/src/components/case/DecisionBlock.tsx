import { useState } from 'react'
import type { Decision } from '../../api/schemas'
import { DecisionExplanation } from '../floor/DecisionExplanation'
import { Badge } from '../primitives'
import { OverrideDialog } from './OverrideDialog'

interface DecisionBlockProps {
  caseId: string
  decision: Decision
}

/** The explanation, any policy blocks, and the override entry point (section 10.7). */
export function DecisionBlock({ caseId, decision }: DecisionBlockProps) {
  const [overrideOpen, setOverrideOpen] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <DecisionExplanation text={decision.explanation} />

      {decision.blocked_actions.length > 0 && (
        <div className="flex flex-col gap-1">
          {decision.blocked_actions.map((b) => (
            <p key={b.action} className="font-sans text-[11px] text-warn">
              Policy "{b.policy_name}" removed {b.action}.
            </p>
          ))}
        </div>
      )}

      {decision.decided_by === 'human_override' && <Badge tone="muted">Human override</Badge>}

      <div>
        <button
          type="button"
          onClick={() => setOverrideOpen(true)}
          className="font-sans text-[13px] text-muted underline decoration-rule underline-offset-2 hover:text-ink"
        >
          Override decision
        </button>
      </div>

      {overrideOpen && (
        <OverrideDialog
          caseId={caseId}
          currentAction={decision.chosen_action}
          blockedActions={decision.blocked_actions}
          onClose={() => setOverrideOpen(false)}
        />
      )}
    </div>
  )
}
