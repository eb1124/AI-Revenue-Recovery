import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  AuditEntrySchema,
  CaseDetailSchema,
  CaseListItemSchema,
  PolicySchema,
  RunMetricsSchema,
  RunSummarySchema,
  WatchlistEntrySchema,
  runStreamEventSchemas,
} from '../src/api/schemas'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '..', 'src', 'mocks', 'fixtures')

let failures = 0

function loadJson(filename: string): unknown {
  const path = join(FIXTURES_DIR, filename)
  const text = readFileSync(path, 'utf-8')
  return JSON.parse(text)
}

function reportOk(filename: string, count: number | string) {
  console.log(`  ok   ${filename}  (${count})`)
}

function reportFail(filename: string, err: z.ZodError, index?: number | string) {
  failures += 1
  console.error(`  FAIL ${filename}${index !== undefined ? ` [index ${index}]` : ''}`)
  for (const issue of err.issues.slice(0, 5)) {
    console.error(`         at ${issue.path.join('.') || '(root)'}: ${issue.message}`)
  }
}

function checkArray<T>(filename: string, schema: z.ZodType<T>) {
  const data = loadJson(filename)
  if (!Array.isArray(data)) {
    failures += 1
    console.error(`  FAIL ${filename}: expected a JSON array at the top level`)
    return
  }
  let ok = true
  data.forEach((item, i) => {
    const result = schema.safeParse(item)
    if (!result.success) {
      ok = false
      reportFail(filename, result.error, i)
    }
  })
  if (ok) reportOk(filename, `${data.length} items`)
}

function checkSingle<T>(filename: string, schema: z.ZodType<T>) {
  const data = loadJson(filename)
  const result = schema.safeParse(data)
  if (!result.success) {
    reportFail(filename, result.error)
    return
  }
  reportOk(filename, '1 record')
}

function checkRecordMap<T>(filename: string, schema: z.ZodType<T>) {
  const data = loadJson(filename)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    failures += 1
    console.error(`  FAIL ${filename}: expected a JSON object keyed by id`)
    return
  }
  let ok = true
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const result = schema.safeParse(value)
    if (!result.success) {
      ok = false
      reportFail(filename, result.error, key)
    }
    const id = (value as { event?: { id?: string } })?.event?.id
    if (id !== undefined && id !== key) {
      ok = false
      failures += 1
      console.error(`  FAIL ${filename} [key ${key}]: object key does not match event.id ("${id}")`)
    }
  }
  if (ok) reportOk(filename, `${Object.keys(data as object).length} records`)
}

function checkStreamEvents(filename: string) {
  const data = loadJson(filename)
  if (!Array.isArray(data)) {
    failures += 1
    console.error(`  FAIL ${filename}: expected a JSON array at the top level`)
    return
  }
  let ok = true
  data.forEach((entry, i) => {
    const envelope = z.object({ event: z.string(), data: z.unknown() }).safeParse(entry)
    if (!envelope.success) {
      ok = false
      reportFail(filename, envelope.error, i)
      return
    }
    const eventName = envelope.data.event as keyof typeof runStreamEventSchemas
    const schema = runStreamEventSchemas[eventName]
    if (!schema) {
      ok = false
      failures += 1
      console.error(`  FAIL ${filename} [index ${i}]: unknown event name "${envelope.data.event}"`)
      return
    }
    const result = schema.safeParse(envelope.data.data)
    if (!result.success) {
      ok = false
      reportFail(`${filename} (event: ${eventName})`, result.error, i)
    }
  })
  if (ok) reportOk(filename, `${data.length} events`)
}

function checkHashChain(filename: string) {
  const data = loadJson(filename) as { prev_hash: string; hash: string }[]
  let ok = true
  let expectedPrev = '0'.repeat(64)
  for (let i = 0; i < data.length; i++) {
    if (data[i].prev_hash !== expectedPrev) {
      ok = false
      failures += 1
      console.error(`  FAIL ${filename}: chain broken at index ${i} — prev_hash does not match previous entry's hash`)
      break
    }
    expectedPrev = data[i].hash
  }
  if (ok) console.log(`  ok   ${filename} hash chain (${data.length} entries, unbroken)`)
}

console.log('Checking fixtures against src/api/schemas.ts...\n')

checkArray('runs.json', RunSummarySchema)
checkArray('cases.json', CaseListItemSchema)
checkRecordMap('case-details.json', CaseDetailSchema)
checkSingle('metrics.json', RunMetricsSchema)
checkArray('watchlist.json', WatchlistEntrySchema)
checkArray('policies.json', PolicySchema)
checkArray('audit.json', AuditEntrySchema)
checkHashChain('audit.json')
checkStreamEvents('stream-events.json')

console.log('')
if (failures > 0) {
  console.error(`${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log('All fixtures valid.')
}
