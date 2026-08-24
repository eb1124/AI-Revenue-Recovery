import { NavLink } from 'react-router-dom'
import { cn } from '../../lib/cn'

const NAV_LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Floor', end: true },
  { to: '/cases', label: 'Cases' },
  { to: '/ledger', label: 'Ledger' },
  { to: '/watchlist', label: 'Watchlist' },
  { to: '/policy', label: 'Policy' },
  { to: '/world', label: 'World' },
  { to: '/audit', label: 'Audit' },
]

export function TopNav() {
  return (
    <nav className="flex h-12 items-center gap-6 border-b border-rule px-6">
      {/* The one place indigo appears outside a HOLD decision — this literally is the word "hold". */}
      <NavLink to="/" end className="font-sans text-[15px] font-medium text-hold">
        HOLD
      </NavLink>
      <div className="flex items-center gap-5">
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => cn('font-sans text-[13px]', isActive ? 'text-ink' : 'text-muted hover:text-ink')}
          >
            {link.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
