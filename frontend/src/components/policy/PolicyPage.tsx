import { useEffect, useState } from 'react'
import { usePolicies, useTogglePolicy } from '../../api/queries'
import type { Policy, PolicyKind } from '../../api/schemas'
import { cn } from '../../lib/cn'
import { useRunStore } from '../../store/useRunStore'
import { Badge, EmptyState, ErrorState, Rule, Switch } from '../primitives'
import { PolicyImpact } from './PolicyImpact'
import { ProposePolicy } from './ProposePolicy'

const KIND_LABEL: Record<PolicyKind, string> = {
  hard_block: 'Hard block',
  cap: 'Cap',
  require_approval: 'Require approval',
}

function PolicyRow({ policy, selected, onSelect }: { policy: Policy; selected: boolean; onSelect: () => void }) {
  const toggle = useTogglePolicy()
  const [justToggled, setJustToggled] = useState(false)

  function handleToggle(enabled: boolean) {
    toggle.mutate({ policyId: policy.id, enabled })
    setJustToggled(true)
    setTimeout(() => setJustToggled(false), 3000)
  }

  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex cursor-pointer flex-col gap-1.5 border-b border-rule px-3 py-3 last:border-b-0 hover:bg-paper',
        selected && 'bg-paper',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-ink">{policy.name}</span>
        <span className="w-32 shrink-0 font-mono text-[11px] text-muted">{KIND_LABEL[policy.kind]}</span>
        <Badge tone="muted" className="w-14 shrink-0 justify-center">
          {policy.trigger_count}
        </Badge>
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <Switch checked={policy.enabled} onChange={handleToggle} label={`Toggle ${policy.name}`} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-0">
        {policy.applies_to.map((action) => (
          <Badge key={action} tone="default" className="font-mono text-[10px]">
            {action}
          </Badge>
        ))}
      </div>
      {justToggled && <p className="font-sans text-[11px] text-faint">Takes effect on the next decision.</p>}
    </div>
  )
}

/** The guardrail console (section 10.10). */
export function PolicyPage() {
  const activeRunId = useRunStore((s) => s.activeRunId)
  const { data: policies, isLoading, isError } = usePolicies()
  const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedPolicyId && policies && policies.length > 0) {
      // Default to the quiet-hours policy — the literal example in 10.10's
      // PolicyImpact copy ("Quiet hours blocked 71 messages...").
      const quietHours = policies.find((p) => p.name.toLowerCase().startsWith('quiet hours'))
      setSelectedPolicyId((quietHours ?? policies[0]).id)
    }
  }, [policies, selectedPolicyId])

  if (isLoading) return <EmptyState title="Loading policies…" />
  if (isError) return <ErrorState title="Couldn't load policies." description="The request failed. Try reloading." />
  if (!policies || policies.length === 0) return <EmptyState title="No policies configured." />

  const selectedPolicy = policies.find((p) => p.id === selectedPolicyId) ?? policies[0]

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto pb-6">
      <div className="flex flex-col">
        <div className="flex items-center gap-3 border-b border-rule px-3 pb-2 font-sans text-[11px] uppercase tracking-[0.09em] text-faint">
          <span className="flex-1">Policy</span>
          <span className="w-32 shrink-0">Kind</span>
          <span className="w-14 shrink-0 text-center">Triggers</span>
          <span className="w-8 shrink-0" />
        </div>
        {policies.map((policy) => (
          <PolicyRow key={policy.id} policy={policy} selected={policy.id === selectedPolicy.id} onSelect={() => setSelectedPolicyId(policy.id)} />
        ))}
      </div>

      <Rule />

      <PolicyImpact runId={activeRunId} policy={selectedPolicy} />

      <Rule />

      <ProposePolicy />
    </div>
  )
}
