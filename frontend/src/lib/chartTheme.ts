import type { CSSProperties } from 'react'

// Shared Recharts restyling: hairline axes in --color-rule, no grid fill
// (so: no <CartesianGrid> at all — the data tables in this product never
// show gridlines either, section 10.2), mono tick labels, no legend boxes
// (series get direct labels or callouts instead), no rounded bar caps. Used
// by both the Ledger (10.8) and Watchlist (10.9) screens.
export const AXIS_STROKE = 'var(--color-rule)'

export const TICK_STYLE = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  fill: 'var(--color-faint)',
}

export const TOOLTIP_CONTENT_STYLE: CSSProperties = {
  border: '1px solid var(--color-rule)',
  borderRadius: 4,
  background: 'var(--color-card)',
  boxShadow: 'none',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  padding: '6px 8px',
}

export const TOOLTIP_LABEL_STYLE: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
  color: 'var(--color-faint)',
  marginBottom: 2,
}

// Recharts' Tooltip formatter/labelFormatter types accept `ValueType`
// (number | string | Array<...> | undefined), not a plain number — this
// coerces at the call site instead of fighting that union with casts.
export function toNumber(v: unknown): number {
  return typeof v === 'number' ? v : Number(v)
}
