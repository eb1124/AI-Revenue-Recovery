import { useParams } from 'react-router-dom'
import { EmptyState } from '../primitives'

export function CaseFilePage() {
  const { id } = useParams<{ id: string }>()
  return <EmptyState title="The case file isn't built yet." description={`This will show the full decision trace for ${id}.`} />
}
