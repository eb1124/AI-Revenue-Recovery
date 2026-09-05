import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { get, post, put } from './client'
import {
  AuditListResponseSchema,
  AuditVerifyResponseSchema,
  CaseDetailSchema,
  CasesListResponseSchema,
  PolicyProposalSchema,
  PolicySchema,
  PolicySimulateResponseSchema,
  RunDetailSchema,
  RunMetricsSchema,
  RunSummarySchema,
  WatchlistDetailSchema,
  WatchlistEntrySchema,
  WorldConfigSchema,
  WorldSweepResponseSchema,
  type Arm,
  type AuditStage,
  type CaseOverrideRequest,
  type PolicyCreateRequest,
  type PolicyUpdateRequest,
  type RunCreateRequest,
  type WorldConfigCreateRequest,
} from './schemas'

const runsListKey = ['runs'] as const

export function useRuns() {
  return useQuery({
    queryKey: runsListKey,
    queryFn: () => get('/api/runs', z.array(RunSummarySchema)),
  })
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ['runs', runId],
    queryFn: () => get(`/api/runs/${runId}`, RunDetailSchema),
    enabled: runId !== null,
  })
}

// A run's summary genuinely doesn't exist until metrics have materialized
// for it (still-running/pending/failed runs 404 here per the mock — see
// handlers/runs.ts) — that's expected, not a transient failure, so don't retry.
export function useRunMetrics(runId: string | null) {
  return useQuery({
    queryKey: ['runs', runId, 'summary'],
    queryFn: () => get(`/api/runs/${runId}/summary`, RunMetricsSchema),
    enabled: runId !== null,
    retry: false,
  })
}

// Not per-run — the 200-world sweep (section 6.5) is pre-computed once and
// cached, per 10.11: "never re-run it live from cold."
export function useWorldSweep() {
  return useQuery({
    queryKey: ['world', 'sweep'],
    queryFn: () => get('/api/world/sweep', WorldSweepResponseSchema),
  })
}

// ActionMix (Ledger screen) needs a per-action-type breakdown, which
// RunMetrics/ArmMetrics doesn't carry (only a total `actions_taken` and the
// `holds` count) — so it's tallied client-side from the real case list
// rather than guessed. `limit=1000` covers this project's fixture sizes in
// one request; a production run would need this paginated properly.
export function useCasesByArm(runId: string | null, arm: Arm) {
  return useQuery({
    queryKey: ['cases', 'by-arm', runId, arm],
    queryFn: () => get(`/api/cases?run_id=${runId}&arm=${arm}&limit=1000`, CasesListResponseSchema),
    enabled: runId !== null,
  })
}

// Watchlist entries are a per-completed-run snapshot (handlers/watchlist.ts
// returns [] for any run_id other than the completed one), same convention
// as the Ledger screen — so this is keyed off activeRunId, not a fixed id.
export function useWatchlist(runId: string | null) {
  return useQuery({
    queryKey: ['watchlist', runId],
    queryFn: () => get(`/api/watchlist?run_id=${runId}`, z.array(WatchlistEntrySchema)),
    enabled: runId !== null,
  })
}

export function useWatchlistDetail(customerId: string | null) {
  return useQuery({
    queryKey: ['watchlist', 'detail', customerId],
    queryFn: () => get(`/api/watchlist/${customerId}`, WatchlistDetailSchema),
    enabled: customerId !== null,
  })
}

const policiesListKey = ['policies'] as const

export function usePolicies() {
  return useQuery({
    queryKey: policiesListKey,
    queryFn: () => get('/api/policies', z.array(PolicySchema)),
  })
}

export function useTogglePolicy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ policyId, enabled }: { policyId: string; enabled: boolean }) => {
      const body: PolicyUpdateRequest = { enabled }
      return put(`/api/policies/${policyId}`, PolicySchema, body)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: policiesListKey }),
  })
}

// Operator free text -> LLM-structured rule proposal (4.4 job 5). Nothing
// auto-applies — this only returns the draft for the diff-style review UI.
export function useProposePolicy() {
  return useMutation({
    mutationFn: (text: string) => post('/api/policies/propose', PolicyProposalSchema, { text }),
  })
}

export function useAddPolicy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: PolicyCreateRequest) => post('/api/policies', PolicySchema, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: policiesListKey }),
  })
}

// "What does this policy cost us" (10.10's PolicyImpact panel).
export function useSimulatePolicy(runId: string | null) {
  return useMutation({
    mutationFn: (policyId: string) => post('/api/policies/simulate', PolicySimulateResponseSchema, { run_id: runId, policies: [policyId] }),
  })
}

export interface AuditFilters {
  runId: string | null
  stage: AuditStage | null
  customerId: string
  q: string
}

function auditQueryString(filters: AuditFilters, cursor: string | null): string {
  const params = new URLSearchParams()
  if (filters.runId) params.set('run_id', filters.runId)
  if (filters.stage) params.set('stage', filters.stage)
  if (filters.customerId.trim()) params.set('customer_id', filters.customerId.trim())
  if (filters.q.trim()) params.set('q', filters.q.trim())
  if (cursor) params.set('cursor', cursor)
  params.set('limit', '75')
  return params.toString()
}

// Cursor-paginated (75/page) and consumed via useVirtualizer's dynamic
// range — the hash chain fixture alone is 300 entries, and a real audit log
// only grows, so this is a genuine infinite list, not a single big fetch
// (unlike e.g. useCasesByArm's limit=1000, which is a bounded, one-off
// per-run tally).
export function useAuditLog(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: ['audit', filters],
    queryFn: ({ pageParam }) => get(`/api/audit?${auditQueryString(filters, pageParam)}`, AuditListResponseSchema),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  })
}

export function useVerifyAuditChain(runId: string | null) {
  return useMutation({
    mutationFn: () => get(`/api/audit/verify${runId ? `?run_id=${runId}` : ''}`, AuditVerifyResponseSchema),
  })
}

// Command palette (section 10.6: "`/` -> focus search... jumping to a case
// by customer name or id"). Reuses /api/cases' existing `q` filter (matches
// customer name, city, and id — see handlers/cases.ts) rather than adding a
// second search endpoint.
export function useCaseSearch(q: string) {
  const query = q.trim()
  return useQuery({
    queryKey: ['cases', 'search', query],
    queryFn: () => get(`/api/cases?q=${encodeURIComponent(query)}&limit=8`, CasesListResponseSchema),
    enabled: query.length > 0,
  })
}

export function useCase(caseId: string | null) {
  return useQuery({
    queryKey: ['cases', caseId],
    queryFn: () => get(`/api/cases/${caseId}`, CaseDetailSchema),
    enabled: caseId !== null,
  })
}

export function useOverrideCase(caseId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CaseOverrideRequest) => post(`/api/cases/${caseId}/override`, CaseDetailSchema, body),
    onSuccess: (data) => queryClient.setQueryData(['cases', caseId], data),
  })
}

function useRunControlMutation(action: 'pause' | 'resume') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) => post(`/api/runs/${runId}/${action}`, RunDetailSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: runsListKey }),
  })
}

// Launching a run (World screen, section 10.11) is a two-step create: the
// slider state becomes a saved WorldConfig first, then the run references
// its id (8.4's RunCreateRequest takes world_config_id, not raw params).
export function useCreateWorldConfig() {
  return useMutation({
    mutationFn: (body: WorldConfigCreateRequest) => post('/api/world/configs', WorldConfigSchema, body),
  })
}

export function useCreateRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: RunCreateRequest) => post('/api/runs', RunSummarySchema, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: runsListKey }),
  })
}

export function usePauseRun() {
  return useRunControlMutation('pause')
}

export function useResumeRun() {
  return useRunControlMutation('resume')
}

// NOTE: neither RunSummary nor RunDetail carries a `speed` field (section
// 8.4) — speed is a stream-runtime concept that only appears in the
// `run.progress` SSE payload (8.5). This mutation still round-trips through
// the REST endpoint (so the backend's chosen speed takes effect), but until
// a screen wires the live stream into useRunStore.setStreamProgress, the UI
// has no authoritative "current speed" to read back — see RunBar's local
// fallback state.
export function useSetRunSpeed() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ runId, speed }: { runId: string; speed: number }) => post(`/api/runs/${runId}/speed`, RunDetailSchema, { speed }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: runsListKey }),
  })
}
