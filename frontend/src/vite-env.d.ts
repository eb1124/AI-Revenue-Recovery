/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" to boot MSW and serve fixture data instead of a real backend. */
  readonly VITE_USE_MOCKS?: string
  /** Base URL the API client and SSE stream connect to. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
