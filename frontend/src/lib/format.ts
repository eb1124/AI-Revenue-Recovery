// Sim timestamps are simulated-world time, not the viewer's real clock — so
// these format in UTC always, rather than the browser's local timezone,
// otherwise the same case would read a different time of day on every judge's
// laptop.
const simDateTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
})

const simTimeFormatter = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
})

const simDateFormatter = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
})

/** "04 Sep 14:32" */
export function formatSimDateTime(iso: string): string {
  return simDateTimeFormatter.format(new Date(iso))
}

/** "14:32" */
export function formatSimTime(iso: string): string {
  return simTimeFormatter.format(new Date(iso))
}

/** "04 Sep" — day-level granularity (Watchlist score timeline, section 10.9), no time-of-day noise. */
export function formatSimDate(iso: string): string {
  return simDateFormatter.format(new Date(iso))
}
