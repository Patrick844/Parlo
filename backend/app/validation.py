"""Server-side answer validation.

The LLM proposes answers; this module decides what actually gets stored.
Each validator returns (ok, normalized_value, error_message). The error
message is written in the assistant's voice so it can be sent straight back
to the respondent when the proposed answer doesn't fit the question.
"""

import re

from .models import Question

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

ValidationResult = tuple[bool, object, str]


def _fail(message: str) -> ValidationResult:
    return False, None, message


def validate_answer(question: Question, value: object) -> ValidationResult:
    """Check `value` against the question's type. Never trust the LLM blindly."""

    if question.type == "text":
        if not (isinstance(value, str) and value.strip()):
            return _fail("Could you share a few words on that?")
        cleaned = value.strip()
        # Character limits are optional. When no min is set, ANY non-empty
        # answer is accepted — a short reply is never rejected.
        min_length = _config_int(question, "min_length")
        max_length = _config_int(question, "max_length")
        if min_length is not None and len(cleaned) < min_length:
            plural = "character" if min_length == 1 else "characters"
            return _fail(f"Please use at least {min_length} {plural}.")
        if max_length is not None and len(cleaned) > max_length:
            return _fail(f"Please keep it under {max_length} characters.")
        return True, cleaned, ""

    if question.type == "email":
        if isinstance(value, str) and EMAIL_RE.match(value.strip()):
            return True, value.strip().lower(), ""
        return _fail("Hmm, that doesn't look like a valid email address — mind double-checking it?")

    if question.type == "rating":
        # A whole number on the creator's configured scale (defaults 1..5).
        low = _config_int(question, "min_value", 1)
        high = _config_int(question, "max_value", 5)
        if low > high:
            low, high = high, low
        try:
            number = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return _fail(f"Please pick a number from {low} to {high}.")
        if number.is_integer() and low <= int(number) <= high:
            return True, int(number), ""
        return _fail(f"Please pick a number from {low} to {high}.")

    if question.type == "number":
        try:
            number = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return _fail("A number would be ideal here — could you try again?")
        # Optional allowed range.
        low = _config_int(question, "min_value")
        high = _config_int(question, "max_value")
        if low is not None and number < low:
            return _fail(f"Please enter a number that's at least {low}.")
        if high is not None and number > high:
            return _fail(f"Please enter a number no greater than {high}.")
        # Store ints as ints so 7 doesn't become 7.0 in exports.
        return True, int(number) if number.is_integer() else number, ""

    if question.type == "single_choice":
        options = question.options or []
        picked = _match_option(value, options)
        if picked is not None:
            return True, picked, ""
        return _fail(
            "Just so I record it right — could you pick one of: " + ", ".join(options) + "?"
        )

    if question.type == "multi_choice":
        options = question.options or []
        raw = value if isinstance(value, list) else [value]
        picked_list: list[str] = []
        for item in raw:
            picked = _match_option(item, options)
            if picked is None:
                return _fail(
                    "Could you choose from these options (one or more): "
                    + ", ".join(options)
                    + "?"
                )
            if picked not in picked_list:
                picked_list.append(picked)
        if not picked_list:
            return _fail("Could you pick at least one of: " + ", ".join(options) + "?")
        # Optional cap on how many options a respondent may choose.
        max_choices = _config_int(question, "max_choices")
        if max_choices is not None and len(picked_list) > max_choices:
            plural = "option" if max_choices == 1 else "options"
            return _fail(f"Please pick at most {max_choices} {plural}.")
        return True, picked_list, ""

    if question.type == "distribution":
        # A mapping of option → points; every key must be a known option, every
        # value a number >= 0, and the whole thing must add up to 100.
        options = question.options or []
        needs_100 = "Assign points to each option so they add up to 100."
        if not isinstance(value, dict):
            return _fail(needs_100)
        allocation: dict = {}
        total = 0.0
        for key, raw in value.items():
            picked = _match_option(key, options)
            if picked is None:
                return _fail(needs_100)
            try:
                number = float(raw)
            except (TypeError, ValueError):
                return _fail(needs_100)
            if number < 0:
                return _fail(needs_100)
            # Store whole points as ints so 40 doesn't become 40.0 in exports.
            allocation[picked] = int(number) if number.is_integer() else number
            total += number
        if abs(total - 100) >= 0.5:
            return _fail(needs_100)
        return True, allocation, ""

    return _fail("I didn't quite catch that — could you rephrase?")


def _config_int(question: Question, key: str, default: int | None = None) -> int | None:
    """Read one integer setting from the question's config, or `default` when it
    is missing or not a whole number. Config is sanitized on write, so this is a
    light second line of defence for older / hand-edited rows."""
    config = getattr(question, "config", None) or {}
    value = config.get(key)
    if isinstance(value, bool) or value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _match_option(value: object, options: list) -> str | None:
    """Case-insensitive match of a proposed value against the allowed options."""
    if not isinstance(value, str):
        return None
    lowered = value.strip().lower()
    for option in options:
        if isinstance(option, str) and option.strip().lower() == lowered:
            return option
    return None
