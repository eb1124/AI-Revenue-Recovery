import { createHash } from 'node:crypto'
import type { AuditActor, AuditEntry, AuditStage, CaseListItem } from '../../src/api/schemas'
import { makeIdFactory } from './ids'
import { type Rng, isoAddSeconds, pick, randInt, weightedPick } from './rng'

const GENESIS_HASH = '0'.repeat(64)

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

const STAGES: AuditStage[] = ['detect', 'diagnose', 'score', 'decide', 'act', 'verify', 'policy', 'override']
const STAGE_SHARES = [22, 16, 16, 20, 12, 10, 3, 1]
const ACTORS_BY_STAGE: Record<AuditStage, [AuditActor[], number[]]> = {
  detect: [['engine', 'simulator'], [70, 30]],
  diagnose: [['engine', 'llm'], [35, 65]],
  score: [['engine'], [100]],
  decide: [['engine'], [100]],
  act: [['engine'], [100]],
  verify: [['engine', 'simulator'], [40, 60]],
  policy: [['engine'], [100]],
  override: [['human'], [100]],
}

const SUMMARIES: Record<AuditStage, string[]> = {
  detect: [
    'payment_initiated with no terminal state for 30 minutes.',
    'Renewal declined by issuer at scheduled billing time.',
    'UPI collect request timed out.',
  ],
  diagnose: [
    'Classified as insufficient_funds, confidence 0.79.',
    'Classified as upi_timeout, confidence 0.86.',
    'Classified as do_not_honour, confidence 0.71.',
    'Classified as expired_card, confidence 0.94.',
  ],
  score: ['p_baseline computed from calibrated model.', 'Bootstrap CI computed across 20 resamples.'],
  decide: ['Chose HOLD — no action beats doing nothing.', 'Chose NUDGE_FREE — clears minimum edge.', 'Chose RETRY_SCHEDULED — timed to salary window.'],
  act: ['Sent WhatsApp reminder.', 'Retry executed on gateway.', 'Queued for human review.'],
  verify: ['Customer self-recovered before any action.', 'Payment completed after intervention.', 'No response — marked lost.'],
  policy: ['NUDGE_INCENTIVE blocked: flagged farmer.', 'Quiet hours blocked outbound message.', 'Value above ₹25,000 — human approval required.'],
  override: ['Human override: recommendation changed from HOLD to NUDGE_FREE.'],
}

export function buildAuditChain(
  rng: Rng,
  idf: ReturnType<typeof makeIdFactory>,
  opts: { runId: string; startedAtIso: string; windowDays: number; cases: CaseListItem[]; count: number },
): AuditEntry[] {
  const entries: AuditEntry[] = []
  let prevHash = GENESIS_HASH
  let simTime = opts.startedAtIso

  for (let i = 0; i < opts.count; i++) {
    const stage = weightedPick(rng, STAGES, STAGE_SHARES)
    const [actors, actorShares] = ACTORS_BY_STAGE[stage]
    const actor = weightedPick(rng, actors, actorShares)
    const relatedCase = rng() < 0.85 ? pick(rng, opts.cases) : null

    simTime = isoAddSeconds(simTime, randInt(rng, 5, 900))
    const wallTime = isoAddSeconds(simTime, -randInt(rng, 0, 40))

    const detail: Record<string, unknown> =
      relatedCase !== null
        ? { cause_code: relatedCase.cause_code, value_at_risk_paise: relatedCase.value_at_risk_paise, arm: relatedCase.arm }
        : { note: 'run-level event' }

    const withoutHash = {
      id: idf('aud'),
      run_id: opts.runId,
      risk_event_id: relatedCase?.id ?? null,
      customer_id: relatedCase?.customer.id ?? null,
      stage,
      summary: pick(rng, SUMMARIES[stage]),
      detail,
      actor,
      sim_time: simTime,
      wall_time: wallTime,
      prev_hash: prevHash,
    }

    const hash = sha256(JSON.stringify(withoutHash))
    entries.push({ ...withoutHash, hash })
    prevHash = hash
  }

  return entries
}
