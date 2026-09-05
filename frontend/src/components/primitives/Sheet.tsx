import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useEscapeKey } from '../../lib/useEscapeKey'

interface SheetProps {
  open: boolean
  onClose: () => void
  widthPx?: number
  children: ReactNode
}

/**
 * A right-anchored panel over the current screen — used by the case file
 * (section 10.7). No slide/fade transition: section 10.4 enumerates the
 * product's motion exhaustively ("exactly four uses") and a sheet entrance
 * isn't one of them, so this opens instantly rather than adding a fifth.
 */
export function Sheet({ open, onClose, widthPx = 720, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  useEscapeKey(onClose, open)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
      previouslyFocused.current?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-20 flex justify-end">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="relative h-full shrink-0 overflow-hidden border-l border-rule bg-card outline-none"
        style={{ width: widthPx }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
