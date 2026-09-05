import type { z } from 'zod'

export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type ApiErrorKind = 'network' | 'http' | 'invalid_json' | 'schema'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | undefined
  readonly path: PropertyKey[]
  readonly zodError: z.ZodError | undefined

  constructor(
    message: string,
    opts: {
      kind: ApiErrorKind
      status?: number
      path?: PropertyKey[]
      zodError?: z.ZodError
      cause?: unknown
    },
  ) {
    super(message, { cause: opts.cause })
    this.name = 'ApiError'
    this.kind = opts.kind
    this.status = opts.status
    this.path = opts.path ?? []
    this.zodError = opts.zodError
  }
}

async function rawFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, init)
  } catch (err) {
    throw new ApiError(`Network request failed: ${path}`, { kind: 'network', cause: err })
  }
}

async function parseJson(res: Response, path: string): Promise<unknown> {
  const text = await res.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new ApiError(`Response for ${path} was not valid JSON`, {
      kind: 'invalid_json',
      status: res.status,
      cause: err,
    })
  }
}

/**
 * Fetches `path`, parses the response as JSON, and validates it against
 * `schema`. Throws `ApiError` on any failure — network, non-2xx status,
 * invalid JSON, or schema mismatch. Never falls back to a default value.
 */
export async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await rawFetch(path, init)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(`${init?.method ?? 'GET'} ${path} failed with status ${res.status}`, {
      kind: 'http',
      status: res.status,
      cause: body,
    })
  }

  const json = await parseJson(res, path)
  const result = schema.safeParse(json)

  if (!result.success) {
    const issue = result.error.issues[0]
    const pathStr = issue.path.length > 0 ? issue.path.join('.') : '(root)'
    throw new ApiError(`Response for ${path} did not match schema at "${pathStr}": ${issue.message}`, {
      kind: 'schema',
      status: res.status,
      path: issue.path,
      zodError: result.error,
    })
  }

  return result.data
}

/**
 * Same failure modes as `request`, for endpoints that respond 204 No Content
 * (no body to validate).
 */
export async function requestNoContent(path: string, init?: RequestInit): Promise<void> {
  const res = await rawFetch(path, init)

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new ApiError(`${init?.method ?? 'GET'} ${path} failed with status ${res.status}`, {
      kind: 'http',
      status: res.status,
      cause: body,
    })
  }
}

const jsonHeaders = { 'Content-Type': 'application/json' }

export function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return request(path, schema)
}

export function post<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  return request(path, schema, {
    method: 'POST',
    headers: jsonHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function put<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  return request(path, schema, {
    method: 'PUT',
    headers: jsonHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function postNoContent(path: string, body?: unknown): Promise<void> {
  return requestNoContent(path, {
    method: 'POST',
    headers: jsonHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export function del(path: string): Promise<void> {
  return requestNoContent(path, { method: 'DELETE' })
}
