import type { WatchlistEntry } from '../../src/api/schemas'
import { generateCustomer, round3 } from './build'
import { makeIdFactory } from './ids'
import { type Rng, randFloat, randInt } from './rng'

/**
 * 30 entries: 10 flagged, 14 watch, 6 normal. Skewed toward the interesting
 * tiers — 10.9's mockup only ever shows watch/flagged rows, "normal" tier
 * customers aren't a natural fit for a farming watchlist, so they're a small
 * minority here rather than a third each.
 */
export function buildWatchlist(
  rng: Rng,
  idf: ReturnType<typeof makeIdFactory>,
  rohit: { id: string; display_name: string },
): WatchlistEntry[] {
  const entries: WatchlistEntry[] = []

  // Rohit Menon — ties to case-details.json scenario 3 and the demo script (section 13).
  entries.push({
    customer_id: rohit.id,
    display_name: rohit.display_name,
    farming_tier: 'flagged',
    farming_score: 0.71,
    abandons: 14,
    checkouts_observed: 17,
    incentives_sent: 9,
    incentives_extracted_paise: 412000,
  })

  const tiers: { tier: 'flagged' | 'watch' | 'normal'; count: number }[] = [
    { tier: 'flagged', count: 9 },
    { tier: 'watch', count: 14 },
    { tier: 'normal', count: 6 },
  ]

  for (const { tier, count } of tiers) {
    for (let i = 0; i < count; i++) {
      const customer = generateCustomer(rng, idf)
      const scoreRange: [number, number] = tier === 'flagged' ? [0.66, 0.93] : tier === 'watch' ? [0.36, 0.65] : [0.04, 0.33]
      const farming_score = round3(randFloat(rng, scoreRange[0], scoreRange[1]))
      const checkouts_observed = randInt(rng, 8, 22)
      const abandonShare = tier === 'flagged' ? randFloat(rng, 0.55, 0.9) : tier === 'watch' ? randFloat(rng, 0.35, 0.6) : randFloat(rng, 0.1, 0.32)
      const abandons = Math.min(checkouts_observed, Math.round(checkouts_observed * abandonShare))
      const incentives_sent = tier === 'normal' ? randInt(rng, 0, 2) : randInt(rng, Math.max(1, abandons - 6), abandons)
      const extractedPerIncentive = randInt(rng, 28000, 61000)
      const incentives_extracted_paise = incentives_sent * extractedPerIncentive + randInt(rng, -900, 900)

      entries.push({
        customer_id: customer.id,
        display_name: customer.display_name,
        farming_tier: tier,
        farming_score,
        abandons,
        checkouts_observed,
        incentives_sent,
        incentives_extracted_paise: Math.max(0, incentives_extracted_paise),
      })
    }
  }

  return entries
}
