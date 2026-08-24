import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AuditPage } from './components/audit/AuditPage'
import { CaseFilePage } from './components/case/CaseFilePage'
import { CasesPage } from './components/case/CasesPage'
import { FloorPage } from './components/floor/FloorPage'
import { LedgerPage } from './components/ledger/LedgerPage'
import { PolicyPage } from './components/policy/PolicyPage'
import { AppShell } from './components/shell/AppShell'
import { WatchlistPage } from './components/watchlist/WatchlistPage'
import { WorldPage } from './components/world/WorldPage'
import { KitchenSink } from './dev/KitchenSink'

// The eight routes from section 10.5. Every screen is a placeholder for now
// (see each *Page.tsx) — only the shell (TopNav + RunBar) is real.
const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <FloorPage /> },
      { path: '/cases', element: <CasesPage /> },
      { path: '/cases/:id', element: <CaseFilePage /> },
      { path: '/ledger', element: <LedgerPage /> },
      { path: '/watchlist', element: <WatchlistPage /> },
      { path: '/policy', element: <PolicyPage /> },
      { path: '/world', element: <WorldPage /> },
      { path: '/audit', element: <AuditPage /> },
    ],
  },
]

// Dev-only: import.meta.env.DEV is statically `false` in a `vite build`
// production bundle, so Rollup dead-code-eliminates this whole branch —
// and, since the KitchenSink import becomes unreferenced, KitchenSink.tsx
// itself is dropped from the production chunk graph too.
if (import.meta.env.DEV) {
  routes.push({ path: '/kitchen-sink', element: <KitchenSink /> })
}

export const router = createBrowserRouter(routes)
