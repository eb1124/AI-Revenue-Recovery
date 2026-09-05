import { useState, type FormEvent } from 'react'
import { useAddPolicy, useProposePolicy } from '../../api/queries'
import type { PolicyProposal } from '../../api/schemas'
import { Eyebrow } from '../primitives'

// Every line prefixed "+" — an addition-only diff block, monochrome (ink/
// muted). Deliberately not green: green (--color-gain) is reserved for
// money recovered (section 10.2's colour discipline), and reusing it here
// for "this is new" would blur that reservation. The "+" carries the
// addition semantic instead of colour.
function ProposalDiff({ proposal }: { proposal: PolicyProposal }) {
  const { reasoning, ...policyShape } = proposal
  const lines = JSON.stringify(policyShape, null, 2).split('\n')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col rounded border border-rule bg-paper p-3 font-mono text-[11px] leading-[1.6] text-ink">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-faint" aria-hidden>
              +
            </span>
            <span className="whitespace-pre">{line}</span>
          </div>
        ))}
      </div>
      <p className="font-sans text-[13px] text-muted">{reasoning}</p>
    </div>
  )
}

/**
 * "never contact anyone within 6 hours of a failed delivery" → structured
 * rule (section 10.10). Nothing auto-applies — the proposal renders as a
 * diff-style block and only persists on explicit "Add policy".
 */
export function ProposePolicy() {
  const [text, setText] = useState('')
  const [proposal, setProposal] = useState<PolicyProposal | null>(null)
  const propose = useProposePolicy()
  const addPolicy = useAddPolicy()

  function handlePropose(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || propose.isPending) return
    propose.mutate(text.trim(), { onSuccess: setProposal })
  }

  function handleAdd() {
    if (!proposal) return
    const { reasoning: _reasoning, ...policyShape } = proposal
    addPolicy.mutate(policyShape, {
      onSuccess: () => {
        setProposal(null)
        setText('')
      },
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Propose a policy</Eyebrow>
      <form onSubmit={handlePropose} className="flex items-center gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="never contact anyone within 6 hours of a failed delivery"
          className="flex-1 rounded border border-rule bg-card px-2.5 py-1.5 font-sans text-[13px] text-ink outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={!text.trim() || propose.isPending}
          className="shrink-0 rounded border border-ink bg-ink px-3 py-1.5 font-sans text-[13px] text-paper disabled:opacity-40"
        >
          {propose.isPending ? 'Proposing…' : 'Propose'}
        </button>
      </form>

      {propose.isError && <p className="font-sans text-[13px] text-burn">Couldn't propose a policy. Try again.</p>}

      {proposal && (
        <div className="flex flex-col gap-3">
          <ProposalDiff proposal={proposal} />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleAdd}
              disabled={addPolicy.isPending}
              className="rounded border border-ink bg-ink px-3 py-1.5 font-sans text-[13px] text-paper disabled:opacity-40"
            >
              {addPolicy.isPending ? 'Adding…' : 'Add policy'}
            </button>
            <button type="button" onClick={() => setProposal(null)} className="font-sans text-[13px] text-muted hover:text-ink">
              Discard
            </button>
          </div>
          {addPolicy.isError && <p className="font-sans text-[13px] text-burn">Couldn't add the policy. Try again.</p>}
        </div>
      )}
    </div>
  )
}
