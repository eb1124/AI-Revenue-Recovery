import { Outlet } from 'react-router-dom'
import { RunBar } from './RunBar'
import { TopNav } from './TopNav'

// Design target is 1440×900 (section 2.1); the sub-768px "polite card"
// treatment and the 1024px tablet breakpoint from that section weren't part
// of this task's assigned reading (10.5/10.6) and aren't implemented here.
export function AppShell() {
  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <header className="sticky top-0 z-10 bg-paper">
        <TopNav />
        <RunBar />
      </header>
      <main className="mx-auto max-w-[1440px] px-8 py-6">
        <Outlet />
      </main>
    </div>
  )
}
