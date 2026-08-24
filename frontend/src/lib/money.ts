const full = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const compact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function formatPaise(paise: number, opts?: { compact?: boolean }): string {
  const rupees = paise / 100
  return opts?.compact ? compact.format(rupees) : full.format(rupees)
}
