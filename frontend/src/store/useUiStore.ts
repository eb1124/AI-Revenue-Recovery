import { create } from 'zustand'
import type { Action, Arm, CauseCode, RiskEventStatus } from '../api/schemas'

export interface CaseFilters {
  arm: Arm | null
  status: RiskEventStatus | null
  decision: Action | null
  cause: CauseCode | null
  minValuePaise: number | null
  q: string
}

const defaultCaseFilters: CaseFilters = {
  arm: null,
  status: null,
  decision: null,
  cause: null,
  minValuePaise: null,
  q: '',
}

interface UiStoreState {
  /** Cases screen filter bar (section 8.4 `/api/cases` query params). */
  caseFilters: CaseFilters
  setCaseFilters: (patch: Partial<CaseFilters>) => void
  resetCaseFilters: () => void

  /**
   * The Case-file sheet (section 10.7) — opens as a right sheet over the
   * Floor or Cases screen on row click, independent of routing (the
   * `/cases/:id` route renders the same content full-page instead).
   */
  openCaseSheetId: string | null
  openCaseSheet: (caseId: string) => void
  closeCaseSheet: () => void
}

export const useUiStore = create<UiStoreState>((set) => ({
  caseFilters: defaultCaseFilters,
  setCaseFilters: (patch) => set((state) => ({ caseFilters: { ...state.caseFilters, ...patch } })),
  resetCaseFilters: () => set({ caseFilters: defaultCaseFilters }),

  openCaseSheetId: null,
  openCaseSheet: (caseId) => set({ openCaseSheetId: caseId }),
  closeCaseSheet: () => set({ openCaseSheetId: null }),
}))
