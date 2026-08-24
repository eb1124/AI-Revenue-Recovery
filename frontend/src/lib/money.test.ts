import { describe, expect, it } from 'vitest'
import { formatPaise } from './money'

describe('formatPaise', () => {
  it('formats zero', () => {
    expect(formatPaise(0)).toBe('₹0')
  })

  it('formats a small value', () => {
    expect(formatPaise(34000)).toBe('₹340')
  })

  it('formats a large value with Indian lakh grouping', () => {
    expect(formatPaise(221040000)).toBe('₹22,10,400')
  })

  it('formats a negative value with the sign before the currency symbol', () => {
    expect(formatPaise(-430000)).toBe('-₹4,300')
  })
})
