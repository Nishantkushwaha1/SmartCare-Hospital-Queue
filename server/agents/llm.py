"""One tiny LLM client for every agent. GroqCloud first, ASI:One as backup, None when neither is configured.

Both providers speak the OpenAI chat-completions format, so the same request works for both.
Callers must always have a non-LLM fallback: this returns None on any problem instead of raising."""
import re
from typing import List, Optional

import httpx

from common import ASI1_API_KEY, ASI1_MODEL, GROQ_API_KEY, GROQ_BASE_URL, GROQ_MODEL


def enabled() -> bool:
    return bool(GROQ_API_KEY or ASI1_API_KEY)


FALLBACK_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"]
_good: dict = {}  # provider -> model that last worked (Groq retires models, e.g. llama-3.3-70b-versatile on 2026-08-16)


def _providers():
    if GROQ_API_KEY:
        models = [m for m in dict.fromkeys([_good.get("groq"), GROQ_MODEL, *FALLBACK_MODELS]) if m]
        yield "groq", f"{GROQ_BASE_URL}/chat/completions", GROQ_API_KEY, models
    if ASI1_API_KEY:
        yield "asi1", "https://api.asi1.ai/v1/chat/completions", ASI1_API_KEY, [ASI1_MODEL]


def _body(model: str, messages: List[dict], temperature: float, max_tokens: int) -> dict:
    b = {"model": model, "temperature": temperature, "max_tokens": max(max_tokens, 1200), "messages": messages}
    if model.startswith("openai/gpt-oss"):
        b["reasoning_effort"] = "low"  # reasoning tokens count against max_tokens; keep them small
    return b


async def complete(messages: List[dict], temperature: float = 0.0, timeout: float = 15, max_tokens: int = 400) -> Optional[tuple]:
    """Returns (text, provider) from the first provider/model that answers, else None."""
    for name, url, key, models in _providers():
        for model in models:
            try:
                async with httpx.AsyncClient(timeout=timeout) as c:
                    r = await c.post(url, headers={"Authorization": f"Bearer {key}"}, json=_body(model, messages, temperature, max_tokens))
                if r.status_code == 404 or (r.status_code == 400 and "decommission" in r.text):
                    continue  # model retired: try the next model of this provider
                r.raise_for_status()
                text = re.sub(r"<think>.*?</think>", "", r.json()["choices"][0]["message"]["content"] or "", flags=re.S).strip()
                if text:
                    _good[name] = model
                    return text, name
            except Exception:
                break  # network / auth / rate limit: go to the next provider, then fall back to rules
    return None
