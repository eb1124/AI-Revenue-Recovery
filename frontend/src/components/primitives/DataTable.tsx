import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export interface DataTableColumn<T> {
  key: string
  header: string
  /** Right-aligns the column and renders its cells mono/tabular-nums — for money, probabilities, percentages, IDs (section 10.2). */
  numeric?: boolean
  render: (row: T) => ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  onRowClick?: (row: T) => void
  /** Rendered in place of the body when `rows` is empty — typically an <EmptyState>. */
  emptyState?: ReactNode
  className?: string
}

/** Horizontal hairlines only. No vertical rules, no zebra striping — a printed statement, not a spreadsheet. */
export function DataTable<T>({ columns, rows, getRowKey, onRowClick, emptyState, className }: DataTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>
  }

  return (
    <table className={cn('w-full border-collapse text-[13px]', className)}>
      <thead>
        <tr className="border-b border-rule">
          {columns.map((col) => (
            <th
              key={col.key}
              className={cn(
                'px-3 py-2 font-sans text-[11px] font-normal uppercase tracking-[0.09em] text-faint first:pl-0 last:pr-0',
                col.numeric ? 'text-right' : 'text-left',
              )}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={getRowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn('border-b border-rule leading-[1.2] last:border-b-0', onRowClick && 'cursor-pointer hover:bg-paper')}
          >
            {columns.map((col) => (
              <td
                key={col.key}
                className={cn(
                  'px-3 py-2 text-ink first:pl-0 last:pr-0',
                  col.numeric ? 'text-right font-mono tabular-nums' : 'text-left font-sans',
                  col.className,
                )}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
