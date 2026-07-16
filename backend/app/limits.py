"""In-memory demo guardrails.

Parlo is a public portfolio demo, so these limits exist to keep the OpenAI bill
and the database small — not to be tamper-proof. Every counter lives in process
memory, which means they RESET whenever the server restarts. That's an
acceptable trade-off for a demo; swap for Redis if this ever needs to be durable.
"""

import time
from collections import defaultdict
from datetime import datetime, timezone

# --- limits (also surfaced to the frontend via /api/auth/me) ---
MAX_COLLECTIONS_PER_USER = 15
MAX_AI_GENERATIONS_PER_DAY = 25
ENTER_RATE_LIMIT_PER_HOUR = 15


# --- POST /api/auth/enter rate limit, keyed by client IP ---
_enter_hits: dict[str, list[float]] = defaultdict(list)


def check_enter_rate_limit(ip: str) -> bool:
    """Sliding one-hour window. Returns True (and records the hit) if this IP is
    still under the limit; returns False when it should be turned away with 429."""
    now = time.time()
    window_start = now - 3600
    hits = [t for t in _enter_hits[ip] if t >= window_start]
    if len(hits) >= ENTER_RATE_LIMIT_PER_HOUR:
        _enter_hits[ip] = hits
        return False
    hits.append(now)
    _enter_hits[ip] = hits
    return True


# --- AI generation counter, keyed by (user id, UTC day) ---
_ai_calls: dict[tuple[str, str], int] = defaultdict(int)


def _today_key() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def ai_generations_used(user_id: str) -> int:
    """How many AI question generations this user has spent today."""
    return _ai_calls[(user_id, _today_key())]


def record_ai_generation(user_id: str) -> None:
    """Count one successful AI generation against today's quota."""
    _ai_calls[(user_id, _today_key())] += 1
