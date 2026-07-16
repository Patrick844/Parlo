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
        if isinstance(value, str) and value.strip():
            return True, value.strip(), ""
        return _fail("Could you share a few words on that?")

    if question.type == "email":
        if isinstance(value, str) and EMAIL_RE.match(value.strip()):
            return True, value.strip().lower(), ""
        return _fail("Hmm, that doesn't look like a valid email address — mind double-checking it?")

    if question.type == "rating":
        # Accept "4" or 4.0 as long as it lands on a whole number 1–5.
        try:
            number = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return _fail("Could you give me a number from 1 to 5?")
        if number.is_integer() and 1 <= int(number) <= 5:
            return True, int(number), ""
        return _fail("A whole number from 1 to 5 would be perfect — which would you pick?")

    if question.type == "number":
        try:
            number = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return _fail("A number would be ideal here — could you try again?")
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
        if picked_list:
            return True, picked_list, ""
        return _fail("Could you pick at least one of: " + ", ".join(options) + "?")

    return _fail("I didn't quite catch that — could you rephrase?")


def _match_option(value: object, options: list) -> str | None:
    """Case-insensitive match of a proposed value against the allowed options."""
    if not isinstance(value, str):
        return None
    lowered = value.strip().lower()
    for option in options:
        if isinstance(option, str) and option.strip().lower() == lowered:
            return option
    return None
