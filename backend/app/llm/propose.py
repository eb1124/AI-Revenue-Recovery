"""Job 5 (policy authoring) — section 4.4: "Operator types a free-text rule -> structured rule proposal -> human confirms." Fallback-first, same discipline as narrate.py/adjudicate.py."""

from dataclasses import dataclass

from app.models.enums import Action, PolicyKind

from .client import call_json

MODEL_SONNET = "claude-sonnet-4-6"  # 4.4: jobs 2, 3, 5


@dataclass(frozen=True)
class PolicyProposalResult:
    name: str
    kind: PolicyKind
    applies_to: list[Action]
    rule: dict
    reasoning: str


def _fallback(text: str) -> PolicyProposalResult:
    """No LLM available — a conservative, always-safe draft: hard-block messaging and let the operator refine it. Never silently invents a rule the operator didn't ask for."""
    name = text if len(text) <= 60 else f"{text[:57]}..."
    return PolicyProposalResult(
        name=name,
        kind=PolicyKind.HARD_BLOCK,
        applies_to=[Action.NUDGE_FREE, Action.NUDGE_INCENTIVE],
        rule={"note": "Draft rule inferred from free text — review before adding.", "source_text": text},
        reasoning=f'Interpreted "{text}" as a hard block on messaging actions. Confirm the applies_to list and rule before adding.',
    )


def propose_policy(text: str) -> PolicyProposalResult:
    system = (
        "You convert an operator's free-text compliance request into a structured guardrail policy "
        "for a payment-recovery agent. The action space is exactly: HOLD, RETRY_NOW, RETRY_SCHEDULED, "
        "NUDGE_FREE, NUDGE_INCENTIVE, ESCALATE_HUMAN. Respond with strict JSON: "
        '{"name": str, "kind": "hard_block"|"cap"|"require_approval", "applies_to": [action, ...], '
        '"rule": {"field": str, "op": "eq"|"ne"|"gte"|"gt"|"lte"|"lt"|"in", "value": any}, "reasoning": str}.'
    )
    result = call_json(MODEL_SONNET, system, text)
    if result is None:
        return _fallback(text)
    try:
        return PolicyProposalResult(
            name=str(result["name"]),
            kind=PolicyKind(result["kind"]),
            applies_to=[Action(a) for a in result["applies_to"]],
            rule=dict(result["rule"]),
            reasoning=str(result["reasoning"]),
        )
    except (KeyError, ValueError, TypeError):
        return _fallback(text)
