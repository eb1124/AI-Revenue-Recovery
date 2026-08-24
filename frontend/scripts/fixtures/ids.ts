import type { Rng } from './rng'

// Fake-but-plausible ULIDs: Crockford base32, sortable-looking, prefixed by
// type per spec 5.2 (cus_, evt_, dec_, act_, msg_, pol_, run_, cko_...).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomBase32(rng: Rng, len: number): string {
  let out = ''
  for (let i = 0; i < len; i++) out += CROCKFORD[Math.floor(rng() * CROCKFORD.length)]
  return out
}

export function makeIdFactory(rng: Rng) {
  let counter = 0
  return function id(prefix: string): string {
    counter += 1
    const seq = counter.toString(32).toUpperCase().padStart(4, '0')
    return `${prefix}_01${seq}${randomBase32(rng, 20)}`
  }
}
