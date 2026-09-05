import type { Evidence } from '../../api/schemas'
import { Eyebrow } from '../primitives'

interface EvidenceTableProps {
  evidence: Evidence[]
}

/** signal / value / weight rows under the Diagnosed stage (section 10.7). */
export function EvidenceTable({ evidence }: EvidenceTableProps) {
  if (evidence.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <Eyebrow>Evidence</Eyebrow>
      <div className="flex flex-col gap-0.5">
        {evidence.map((e) => (
          <div key={e.signal} className="flex items-baseline gap-3 leading-[1.2]">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">{e.signal}</span>
            <span className="font-mono text-[13px] text-ink">{e.value}</span>
            <span className="w-14 shrink-0 text-right font-mono text-[11px] text-faint">w {e.weight.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
