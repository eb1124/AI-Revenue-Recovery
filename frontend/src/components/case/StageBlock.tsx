import type { ReactNode } from 'react'
import { Eyebrow } from '../primitives'

const STAGE_NUMERALS = ['①', '②', '③', '④', '⑤', '⑥'] as const

interface StageBlockProps {
  number: 1 | 2 | 3 | 4 | 5 | 6
  title: string
  /** Right-aligned header content — e.g. cause code + confidence, or the chosen action + latency. */
  meta?: ReactNode
  children: ReactNode
}

/** One numbered pipeline stage (section 10.7) — the ①–⑥ order carries information, so it's rendered literally. */
export function StageBlock({ number, title, meta, children }: StageBlockProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[13px] text-muted">{STAGE_NUMERALS[number - 1]}</span>
        <Eyebrow className="text-ink">{title}</Eyebrow>
        {meta && <div className="ml-auto flex items-baseline gap-2">{meta}</div>}
      </div>
      <div className="flex flex-col gap-2 pl-5">{children}</div>
    </div>
  )
}
