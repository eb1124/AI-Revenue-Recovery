"""Job 3 (ambiguous-case adjudication) — section 4.4, using 8.6's exact JSON contract."""

from dataclasses import dataclass

from app.models.enums import Action

from .client import call_json

MODEL_SONNET = "claude-sonnet-4-6"  # 4.4: jobs 2, 3, 5


@dataclass(frozen=True)
class AdjudicationResult:
    recommended_action: Action
    confidence: float
    reasoning: str
    key_factor: str
    dissenting_consideration: str
    fell_back: bool  # True if the LLM call failed/was invalid and this is the safe HOLD default (8.6)


def adjudicate(allowed_actions: list[Action], context: dict) -> AdjudicationResult:
    """
    "When the CI straddles zero on a high-value case, the LLM receives
    structured context + the policy document and returns a recommendation
    with reasoning. Output is schema-validated and clamped to the allowed
    action set." Never lets an LLM failure change the outcome away from
    restraint: "failing safe toward restraint is thematically perfect" (8.6).
    """
    system = (
        "You are an expert billing-recovery adjudicator. Given structured context about an "
        "ambiguous case (its expected-value confidence interval straddles zero), recommend "
        "exactly one action from the allowed set. Respond with strict JSON: "
        '{"recommended_action": str, "confidence": float, "reasoning": str (max 2 sentences), '
        '"key_factor": str, "dissenting_consideration": str}.'
    )
    user = f"allowed_actions={[a.value for a in allowed_actions]}, context={context}"
    result = call_json(MODEL_SONNET, system, user)

    if result is None:
        return AdjudicationResult(Action.HOLD, 1.0, "LLM adjudication unavailable; failing safe to HOLD.", "llm_unavailable", "", fell_back=True)

    try:
        action = Action(result["recommended_action"])
        if action not in allowed_actions:
            raise ValueError("recommended action not in the allowed set")
        return AdjudicationResult(
            recommended_action=action,
            confidence=float(result["confidence"]),
            reasoning=str(result["reasoning"])[:400],
            key_factor=str(result.get("key_factor", "")),
            dissenting_consideration=str(result.get("dissenting_consideration", "")),
            fell_back=False,
        )
    except (KeyError, ValueError, TypeError):
        return AdjudicationResult(Action.HOLD, 1.0, "LLM output failed validation; failing safe to HOLD.", "llm_invalid_output", "", fell_back=True)
