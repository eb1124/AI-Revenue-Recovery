import { CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from 'cmdk'
import { useEffect, useState } from 'react'
import { useCaseSearch } from '../../api/queries'
import { useUiStore } from '../../store/useUiStore'
import { Money } from '../primitives'

/**
 * Global `/` command palette (section 10.6): "focus search... Command
 * palette, cmdk." Mounted once in AppShell, like CaseSheet, so it works
 * from any screen. Search reuses /api/cases' existing `q` filter — matches
 * customer name, city, or case id.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const openCaseSheet = useUiStore((s) => s.openCaseSheet)
  const { data } = useCaseSearch(open ? query : '')

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '/') return
      const target = e.target as HTMLElement | null
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (isTyping) return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  function selectCase(caseId: string) {
    openCaseSheet(caseId)
    setOpen(false)
    setQuery('')
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
      label="Jump to case"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-ink/20"
      contentClassName="fixed left-1/2 top-32 z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded border border-rule bg-card"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Jump to a case by customer name or id…"
        className="w-full border-b border-rule bg-transparent px-3 py-2.5 font-sans text-[13px] text-ink outline-none placeholder:text-faint"
      />
      <CommandList className="max-h-80 overflow-y-auto p-1.5">
        <CommandEmpty className="px-2 py-6 text-center font-sans text-[13px] text-muted">
          {query.trim() ? 'No cases match.' : 'Start typing a name or id.'}
        </CommandEmpty>
        {(data?.items ?? []).map((c) => (
          <CommandItem
            key={c.id}
            value={c.id}
            onSelect={() => selectCase(c.id)}
            className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-2 font-sans text-[13px] text-ink data-[selected=true]:bg-paper"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate">{c.customer.display_name}</span>
              <span className="font-mono text-[11px] text-faint">{c.id}</span>
            </div>
            <Money paise={c.value_at_risk_paise} size="sm" className="shrink-0" />
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
