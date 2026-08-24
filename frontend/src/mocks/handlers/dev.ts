import { http, HttpResponse } from 'msw'
import { DevSeedRequestSchema } from '../../api/schemas'
import { API_BASE } from '../apiBase'
import { resetDb } from '../db'

export const devHandlers = [
  http.post(`${API_BASE}/dev/reset`, () => {
    resetDb()
    return new HttpResponse(null, { status: 204 })
  }),

  // ASSUMED response shape — dev-only seeding endpoint, no example given.
  http.post(`${API_BASE}/dev/seed`, async ({ request }) => {
    const body = DevSeedRequestSchema.parse(await request.json())
    return HttpResponse.json({ ok: true, config: body.config }, { status: 201 })
  }),
]
