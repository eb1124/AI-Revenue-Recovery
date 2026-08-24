import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { get, post } from './client'
import { RunDetailSchema, RunSummarySchema } from './schemas'

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

function useRunControlMutation(action: 'pause' | 'resume') {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (runId: string) => post(`/api/runs/${runId}/${action}`, RunDetailSchema),
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
