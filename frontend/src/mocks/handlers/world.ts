import { http, HttpResponse } from 'msw'
import { WorldConfigCreateRequestSchema, type WorldParams, type WorldSweepResult } from '../../api/schemas'
import { API_BASE } from '../apiBase'
import { db, generateId } from '../db'

// 200 pre-computed sweep results (section 6.5: "run 200 configurations
// offline, store the results"). Deterministic per index so repeated GETs are
// stable. Matches the headline claim in section 13: "187 of 200".
function buildSweepResults(): WorldSweepResult[] {
  const base = db.worldConfigs[0].params
  const results: WorldSweepResult[] = []

  for (let i = 0; i < 200; i++) {
    const t = i / 199
    const jitter = (n: number) => Math.sin(i * 12.9898 + n) * 0.5 + 0.5 // deterministic pseudo-random in [0,1]

    const params: WorldParams = {
      ...base,
      salary_timing_lift: round2(1.0 + jitter(1) * 3.0),
      self_recovery_base: round2(0.05 + jitter(2) * 0.65),
      incentive_elasticity: round2(1.0 + jitter(3) * 2.0),
      farmer_share: round2(jitter(4) * 0.4),
      farmer_learning_rate: round2(jitter(5) * 0.5),
      message_fatigue: round2(jitter(6)),
      optout_sensitivity: round2(jitter(7) * 3),
      seed: i,
    }

    const agentNet = Math.round(400000 + t * 4_800_000 + jitter(8) * 300_000)
    const pessimism = jitter(2) // low self-recovery + high fatigue = harder world
    const baselineNet = Math.round(agentNet * (0.5 + jitter(9) * 0.25))
    const agent_wins = agentNet > baselineNet || pessimism < 0.05

    results.push({ params, agent_net: agentNet, baseline_net: baselineNet, agent_wins })
  }

  // Guarantee the headline number the demo script (section 13) relies on.
  let idx = 0
  while (results.filter((r) => r.agent_wins).length < 187 && idx < results.length) {
    if (!results[idx].agent_wins) results[idx] = { ...results[idx], agent_wins: true, agent_net: results[idx].baseline_net + 10000 }
    idx++
  }
  idx = 0
  while (results.filter((r) => r.agent_wins).length > 187 && idx < results.length) {
    if (results[idx].agent_wins) results[idx] = { ...results[idx], agent_wins: false, agent_net: Math.round(results[idx].baseline_net * 0.9) }
    idx++
  }

  return results
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

let sweepCache: WorldSweepResult[] | null = null

export const worldHandlers = [
  http.get(`${API_BASE}/world/configs`, () => HttpResponse.json(db.worldConfigs)),

  http.post(`${API_BASE}/world/configs`, async ({ request }) => {
    const body = WorldConfigCreateRequestSchema.parse(await request.json())
    const config = { id: generateId('wcf'), name: body.name, params: body.params, created_at: new Date().toISOString() }
    db.worldConfigs.push(config)
    return HttpResponse.json(config, { status: 201 })
  }),

  http.get(`${API_BASE}/world/sweep`, () => {
    if (!sweepCache) sweepCache = buildSweepResults()
    return HttpResponse.json({ results: sweepCache })
  }),
]
