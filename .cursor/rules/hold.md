Save this file in your repo as `.cursor/rules/hold.mdc` — including the frontmatter block at the top. Cursor will attach it to every request automatically, so you never re-explain these.

---

```mdc
---
description: HOLD — project-wide non-negotiables
alwaysApply: true
---

# HOLD — project rules

The full specification is at `/docs/HOLD-master-spec.md`. When a decision is
covered there, follow it exactly rather than inventing an alternative. When it
is not covered, ask before choosing.

## Working style

- Before writing code for any task larger than one file, output a short plan
  (files you will create or change, in order) and wait for me to confirm.
- Make small, reviewable diffs. Do not refactor files I did not ask about.
- Do not add a dependency that is not listed in spec section 10.1 without
  asking first and saying why.
- Never invent an API response shape. Every shape comes from spec section 8.4
  and must be mirrored in `src/api/schemas.ts`. If you need a field that does
  not exist, tell me — do not add it silently.
- If something in the spec looks wrong or contradictory, say so instead of
  quietly working around it.
- Do not write comments that restate the code. Comment only non-obvious
  intent (e.g. why the dwell queue exists).

## Domain rules — these cause real bugs

- All money is stored and passed as **integer paise**. Never floats, never
  rupees, in any variable, prop, fixture or API shape. Field names end in
  `_paise`.
- Rupee formatting happens in exactly one place: `src/lib/money.ts`, using
  `Intl.NumberFormat('en-IN')` so grouping is lakh/crore, not thousands.
  No component formats currency inline.
- Time is doubled: `sim_time` and `wall_time`. Never mix them. UI shows
  `sim_time` unless explicitly told otherwise.
- The six actions are fixed: HOLD, RETRY_NOW, RETRY_SCHEDULED, NUDGE_FREE,
  NUDGE_INCENTIVE, ESCALATE_HUMAN. Do not add a seventh.
- Every API response is parsed through its zod schema before use. A parse
  failure is a visible error, never a silent fallback.

## Visual rules — these are the product's differentiation

- Palette is exactly the nine tokens in spec section 10.2. Do not introduce
  any other colour, including greys not on the list.
- `--color-hold` (#3B3A8F, indigo) is used **only** for HOLD decisions and the
  Hold Ledger. Never for buttons, links, focus rings, charts or anything else.
- Border radius is `4px` everywhere. There is no other radius in the product.
- No box-shadows. No gradients. No borders thicker than 1px. Separation is
  done with 1px `--color-rule` hairlines.
- Two font weights only: 400 and 500. Never 600 or 700.
- Every number on screen — rupees, probabilities, percentages, IDs, counts,
  timestamps — is set in JetBrains Mono with `font-variant-numeric:
  tabular-nums`. All prose is Instrument Sans. This split is absolute.
- Sentence case everywhere. No Title Case. Uppercase only for 11px eyebrow
  labels with 0.09em tracking.
- Data tables: horizontal hairlines only. No vertical rules, no zebra
  striping. Monetary columns right-aligned.
- No emoji anywhere. Icons are lucide-react at stroke-width 1.5, used sparingly.
- Motion is limited to the four uses in spec section 10.4. Do not animate
  anything else. All four are wrapped in
  `@media (prefers-reduced-motion: no-preference)`.
- When using shadcn/ui, restyle it to these tokens on the way in. Default
  shadcn styling is not acceptable in this product.

## Copy rules

- Plain and declarative. The interface is a clerk, not a salesperson.
- No exclamation marks. No "Oops". No "AI-powered". No "Great news".
- Every empty state names the next action. Every error names what happened
  and what to do about it.
- Buttons say what happens: "Start run", not "Submit".

## Quality floor

- Keyboard focus is always visible.
- Every screen has a loading, empty and error state before it is considered done.
- The app targets 1440x900. It must not shatter at 1024px. Below 768px it
  shows a single card reading "HOLD is built for a wider screen."
```
