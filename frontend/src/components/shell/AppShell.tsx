import { Outlet } from 'react-router-dom'
import { CaseSheet } from '../case/CaseSheet'
import { CommandPalette } from './CommandPalette'
import { RunBar } from './RunBar'
import { TopNav } from './TopNav'

// Design target is 1440×900 (section 2.1); the sub-768px "polite card"
// treatment and the 1024px tablet breakpoint from that section weren't part
// of this task's assigned reading (10.5/10.6) and aren't implemented here.
export function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-paper font-sans text-ink">
      <header className="sticky top-0 z-10 shrink-0 bg-paper">
        <TopNav />
        <RunBar />
      </header>
      {/* flex-1 + overflow-hidden so a dense screen like the Floor can fill
          the remaining viewport height; placeholder screens (plain
          EmptyState, shorter than the container) are unaffected. */}
      <main className="mx-auto flex w-full max-w-360 flex-1 flex-col overflow-hidden px-8 py-6">
        <Outlet />
      </main>
      {/* Mounted once here (not per-screen) so any card on any screen can open
          the case file as a sheet — section 10.7 says "opens as a sheet from
          the Floor", but Cases/Watchlist rows will want the same behaviour. */}
      <CaseSheet />
      <CommandPalette />
    </div>
  )
}
