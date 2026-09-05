import type { CaseAuditTrailEntry } from '../../api/schemas'
import { formatSimTime } from '../../lib/format'
import { Badge, Eyebrow } from '../primitives'

interface AuditStripProps {
  entries: CaseAuditTrailEntry[]
}

/**
 * The case's slice of the hash-chained audit log (section 10.7 footer).
 * CaseDetail carries no per-case chain-verification result — that's the
 * Audit screen's GET /api/audit/verify (10.12) — so this shows entry count
 * only, rather than claiming an unverified "chain intact ✓".
 */
export function AuditStrip({ entries }: AuditStripProps) {
  return (
    <div className="flex flex-col gap-2 px-6 pb-6">
      <div className="flex items-baseline gap-2">
        <Eyebrow>Audit</Eyebrow>
        <span className="font-mono text-[11px] tabular-nums text-faint">{entries.length} entries</span>
      </div>
      <div className="flex flex-col gap-1">
        {entries.map((entry, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-faint">{formatSimTime(entry.sim_time)}</span>
            <Badge tone="muted" className="w-16 shrink-0 justify-center">
              {entry.stage}
            </Badge>
            <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-muted">{entry.summary}</span>
            <span className="font-mono text-[11px] text-faint">{entry.actor}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
