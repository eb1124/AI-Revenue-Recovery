import { useEffect } from 'react'

/** Calls `onEscape` while `enabled` is true and the Escape key is pressed. Shared by Sheet and OverrideDialog. */
export function useEscapeKey(onEscape: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return

    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onEscape()
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onEscape, enabled])
}
