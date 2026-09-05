interface DecisionExplanationProps {
  text: string
}

/** One or two sentences from decision.explanation, 13px, muted (section 10.6). */
export function DecisionExplanation({ text }: DecisionExplanationProps) {
  return <p className="font-sans text-[13px] leading-[1.45] text-muted">{text}</p>
}
