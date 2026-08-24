// Deterministic PRNG (mulberry32) so fixtures are reproducible across runs —
// same spirit as the master spec's insistence on a seeded simulator (6.5, seed=42).

export function makeRng(seed: number) {
  let a = seed >>> 0
  return function rng(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Rng = () => number

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

export function randFloat(rng: Rng, min: number, max: number): number {
  return rng() * (max - min) + min
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Weighted pick. `weights` is a parallel array of shares (need not sum to 1). */
export function weightedPick<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * Long-tail money sampler: mostly in [lo, mid], a thin tail up to [tailLo, tailHi].
 * Returns an integer that is deliberately not a clean multiple of 100 (avoids
 * suspicious round rupee amounts like ₹100 / ₹1000 in the paise value).
 */
export function longTailPaise(rng: Rng, loRupees: number, midRupees: number, tailLoRupees: number, tailHiRupees: number): number {
  const isTail = rng() < 0.035
  let rupees: number
  if (isTail) {
    rupees = randFloat(rng, tailLoRupees, tailHiRupees)
  } else {
    // Power-law-ish skew toward the low end of [lo, mid]
    const u = rng()
    const skewed = Math.pow(u, 2.2)
    rupees = loRupees + skewed * (midRupees - loRupees)
  }
  const paise = Math.round(rupees * 100)
  const jitter = randInt(rng, -37, 41) // never a clean multiple of 100
  const result = paise + jitter
  return result === 0 ? 1 : result
}

export function isoAddSeconds(iso: string, seconds: number): string {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z')
}
