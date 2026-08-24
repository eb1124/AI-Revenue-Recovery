// Opaque cursor = base64-encoded offset. Simple, sufficient for a mock over
// a static in-memory array — a real backend would key on the sort column.

export function encodeCursor(offset: number): string {
  return btoa(String(offset))
}

export function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0
  try {
    const n = Number(atob(cursor))
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function paginate<T>(items: T[], cursor: string | null, limit: number): { items: T[]; next_cursor: string | null } {
  const offset = decodeCursor(cursor)
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50
  const page = items.slice(offset, offset + safeLimit)
  const nextOffset = offset + page.length
  const next_cursor = nextOffset < items.length ? encodeCursor(nextOffset) : null
  return { items: page, next_cursor }
}
