import { http, HttpResponse } from 'msw'
import { API_BASE } from '../apiBase'
import { completedRunId, db } from '../db'
import { synthesizeWatchlistDetail } from '../synthesize'

export const watchlistHandlers = [
  http.get(`${API_BASE}/watchlist`, ({ request }) => {
    const url = new URL(request.url)
    const runId = url.searchParams.get('run_id')
    const tier = url.searchParams.get('tier')

    let items = db.watchlist
    if (runId && runId !== completedRunId()) items = []
    if (tier) items = items.filter((w) => w.farming_tier === tier)

    return HttpResponse.json(items)
  }),

  http.get(`${API_BASE}/watchlist/:customerId`, ({ params }) => {
    const entry = db.watchlist.find((w) => w.customer_id === params.customerId)
    if (!entry) return HttpResponse.json({ error: 'not_found' }, { status: 404 })
    return HttpResponse.json(synthesizeWatchlistDetail(entry))
  }),
]
