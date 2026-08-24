// MSW v2 relative-path handlers only match requests to the current page
// origin. api/client.ts targets VITE_API_BASE_URL (typically a different
// port, e.g. localhost:8000, than the Vite dev server). Handlers build their
// match patterns from this same base so they match what the client actually
// requests, on any port.
export const API_BASE = `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'}/api`
