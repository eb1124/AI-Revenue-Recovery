import { useParams } from 'react-router-dom'
import { CaseFile } from './CaseFile'

/** `/cases/:id` — the same <CaseFile> the Sheet renders, full page (section 10.7: "same component, two containers"). */
export function CaseFilePage() {
  const { id } = useParams<{ id: string }>()
  if (!id) return null
  return <CaseFile caseId={id} className="mx-auto w-full max-w-180 border-x border-rule bg-card" />
}
