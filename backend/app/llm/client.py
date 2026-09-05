"""
Thin LLM client wrapper (sections 4.4, 8.6). "Never let an LLM failure break
the run" — every call here returns `None` on ANY failure (missing key,
network error, malformed JSON, rate limit) rather than raising, and every
caller in this codebase has a deterministic fallback ready for exactly that.

No `ANTHROPIC_API_KEY` is configured in this environment, so every call
currently short-circuits to `None` immediately at `_get_client()` — the real
Anthropic wiring below is written but untested against a live key; the
fallback path (which IS exercised end-to-end) is what actually runs the demo
until a key is supplied.
"""

import json
import logging

from app.config import settings

logger = logging.getLogger(__name__)

_client = None
_client_init_attempted = False


def _get_client():
    global _client, _client_init_attempted
    if _client_init_attempted:
        return _client
    _client_init_attempted = True
    if not settings.anthropic_api_key:
        return None
    try:
        import anthropic

        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    except Exception:
        logger.exception("Anthropic client init failed; falling back to deterministic templates")
        _client = None
    return _client


def call_json(model: str, system: str, user: str, max_tokens: int = 512) -> dict | None:
    """A parsed JSON dict, or None on any failure — callers must have a deterministic fallback (8.6)."""
    client = _get_client()
    if client is None:
        return None
    try:
        response = client.messages.create(model=model, max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": user}])
        return json.loads(response.content[0].text)
    except Exception:
        logger.exception("LLM call failed; falling back to deterministic template")
        return None
