import type { Policy } from '../../src/api/schemas'
import { makeIdFactory } from './ids'

// The 11 shipped policies, section 9.3. `rule` follows the predicate style
// shown in 9.2 (field/op/value, optionally wrapped in an `any` combinator) —
// the schema types `rule` as unknown since the full predicate grammar isn't
// specified, but the fixture data itself uses one consistent shape throughout.
export function buildPolicies(idf: ReturnType<typeof makeIdFactory>): Policy[] {
  return [
    {
      id: idf('pol'),
      name: 'Quiet hours 20:00–09:00 IST',
      kind: 'hard_block',
      rule: {
        any: [
          { field: 'sim_time.hour', op: 'gte', value: 20 },
          { field: 'sim_time.hour', op: 'lt', value: 9 },
        ],
      },
      applies_to: ['NUDGE_FREE', 'NUDGE_INCENTIVE'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 71,
    },
    {
      id: idf('pol'),
      name: 'Hard opt-out is permanent',
      kind: 'hard_block',
      rule: { field: 'customer.hard_optout', op: 'eq', value: true },
      applies_to: ['RETRY_NOW', 'RETRY_SCHEDULED', 'NUDGE_FREE', 'NUDGE_INCENTIVE', 'ESCALATE_HUMAN'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 4,
    },
    {
      id: idf('pol'),
      name: 'Maximum 3 contacts per event',
      kind: 'cap',
      rule: { field: 'event.contact_count', op: 'gte', value: 3 },
      applies_to: ['RETRY_NOW', 'RETRY_SCHEDULED', 'NUDGE_FREE', 'NUDGE_INCENTIVE', 'ESCALATE_HUMAN'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 18,
    },
    {
      id: idf('pol'),
      name: 'Maximum 1 message per customer per 24h',
      kind: 'cap',
      rule: { field: 'customer.messages_sent_24h', op: 'gte', value: 1 },
      applies_to: ['NUDGE_FREE', 'NUDGE_INCENTIVE'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 53,
    },
    {
      id: idf('pol'),
      name: 'Maximum 5 messages per customer per 7 days',
      kind: 'cap',
      rule: { field: 'customer.messages_sent_7d', op: 'gte', value: 5 },
      applies_to: ['NUDGE_FREE', 'NUDGE_INCENTIVE'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 9,
    },
    {
      id: idf('pol'),
      name: 'No retries on expired_card / mandate_revoked',
      kind: 'hard_block',
      rule: {
        any: [
          { field: 'event.cause_code', op: 'eq', value: 'expired_card' },
          { field: 'event.cause_code', op: 'eq', value: 'mandate_revoked' },
        ],
      },
      applies_to: ['RETRY_NOW', 'RETRY_SCHEDULED'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 26,
    },
    {
      id: idf('pol'),
      name: 'Maximum 4 mandate retry attempts',
      kind: 'cap',
      rule: { field: 'event.attempt_number', op: 'gte', value: 4 },
      applies_to: ['RETRY_NOW', 'RETRY_SCHEDULED'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 7,
    },
    {
      id: idf('pol'),
      name: 'No incentives to flagged farmers',
      kind: 'hard_block',
      rule: { field: 'customer.farming_tier', op: 'eq', value: 'flagged' },
      applies_to: ['NUDGE_INCENTIVE'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 34,
    },
    {
      id: idf('pol'),
      name: 'Half incentive to watch farmers',
      kind: 'cap',
      rule: { if: { field: 'customer.farming_tier', op: 'eq', value: 'watch' }, max_incentive_bps: 500 },
      applies_to: ['NUDGE_INCENTIVE'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 12,
    },
    {
      id: idf('pol'),
      name: 'Human approval above ₹25,000',
      kind: 'require_approval',
      rule: { field: 'event.value_at_risk_paise', op: 'gte', value: 2500000 },
      applies_to: ['RETRY_NOW', 'RETRY_SCHEDULED', 'NUDGE_FREE', 'NUDGE_INCENTIVE', 'ESCALATE_HUMAN'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 3,
    },
    {
      id: idf('pol'),
      name: '72h cool-down after resolution',
      kind: 'hard_block',
      rule: { field: 'event.hours_since_resolution', op: 'lt', value: 72 },
      applies_to: ['RETRY_NOW', 'RETRY_SCHEDULED', 'NUDGE_FREE', 'NUDGE_INCENTIVE', 'ESCALATE_HUMAN'],
      enabled: true,
      authored_by: 'system',
      trigger_count: 15,
    },
  ]
}
