import { useUiStore } from '../../store/useUiStore'
import { Sheet } from '../primitives'
import { CaseFile } from './CaseFile'

/**
 * Mounted once in AppShell so any card, on any screen, can open the case
 * file as a 720px sheet (section 10.7) without each screen owning its own
 * copy of the open/close state.
 */
export function CaseSheet() {
  const openCaseSheetId = useUiStore((s) => s.openCaseSheetId)
  const closeCaseSheet = useUiStore((s) => s.closeCaseSheet)

  return (
    <Sheet open={openCaseSheetId !== null} onClose={closeCaseSheet} widthPx={720}>
      {openCaseSheetId && <CaseFile caseId={openCaseSheetId} onClose={closeCaseSheet} className="h-full" />}
    </Sheet>
  )
}
