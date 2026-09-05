import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useOverrideCase } from '../../api/queries'
import { ActionSchema, type Action, type BlockedAction } from '../../api/schemas'
import { useEscapeKey } from '../../lib/useEscapeKey'

interface OverrideDialogProps {
  caseId: string
  currentAction: Action
  blockedActions: BlockedAction[]
  onClose: () => void
}

/**
 * Six actions, a required reason, and a policy warning when the selected
 * action was blocked (section 10.7's override flow). Confirming
 * POST /api/cases/{id}/override; the case re-renders with decided_by:
 * human_override and a new audit entry, per the spec.
 */
export function OverrideDialog({ caseId, currentAction, blockedActions, onClose }: OverrideDialogProps) {
  const [selected, setSelected] = useState<Action>(currentAction)
  const [reason, setReason] = useState('')
  const mutation = useOverrideCase(caseId)
  useEscapeKey(onClose, true)

  const blocked = blockedActions.find((b) => b.action === selected)
  const canSubmit = reason.trim().length > 0 && !mutation.isPending

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    mutation.mutate({ action: selected, params: {}, reason: reason.trim() }, { onSuccess: onClose })
  }

  return createPortal(
    <div className="fixed inset-0 z-30 flex items-center justify-center">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <form onSubmit={handleSubmit} role="dialog" aria-modal="true" className="relative flex w-105 flex-col gap-4 rounded border border-rule bg-card p-6">
        <div className="flex flex-col gap-1">
          <p className="font-sans text-[15px] text-ink">Override decision</p>
          <p className="font-sans text-[13px] text-muted">Choose an action and record why. This is written to the audit log against your name.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          {ActionSchema.options.map((action) => (
            <label key={action} className="flex items-center gap-2 font-mono text-[13px] text-ink">
              <input type="radio" name="override-action" value={action} checked={selected === action} onChange={() => setSelected(action)} />
              {action}
            </label>
          ))}
        </div>

        {blocked && (
          <p className="rounded border border-warn/25 bg-warn/10 px-3 py-2 font-sans text-[13px] text-warn">
            Policy "{blocked.policy_name}" removed this action. Overriding will be recorded against your name in the audit log.
          </p>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="font-sans text-[11px] uppercase tracking-[0.09em] text-faint">Reason (required)</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="resize-none rounded border border-rule bg-paper p-2 font-sans text-[13px] text-ink outline-none focus:border-ink"
            placeholder="Why does this override the agent's decision?"
          />
        </label>

        {mutation.isError && <p className="font-sans text-[13px] text-burn">Override failed. Try again.</p>}

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="font-sans text-[13px] text-muted hover:text-ink">
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit} className="rounded border border-ink bg-ink px-3 py-1.5 font-sans text-[13px] text-card disabled:opacity-40">
            {mutation.isPending ? 'Overriding…' : 'Confirm override'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
