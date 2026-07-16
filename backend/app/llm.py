"""All OpenAI calls live here.

The backend owns the interview flow; the model is only used for phrasing and
for parsing free-text answers. Each call is small and single-purpose:

  1. `compose_intro`    — a warm one-line intro (states count + topic).
  2. `phrase_question`  — a short, warm way to ASK one specific question.
  3. `explain_question` — re-explain the current question in simpler words.
  4. `extract_answer`   — parse a TYPED free-text reply into a normalized value
                          (and flag decline / help intents).
  5. `summarize_answers`— dashboard insights + overall sentiment.
  6. `suggest_questions`— draft a batch of questions for the builder.

Phrasing calls fall back to plain deterministic text if the model is
unavailable, so the deterministic flow never breaks on a phrasing hiccup.
"""

import json

from openai import OpenAI

from .config import settings
from .models import Question

_client: OpenAI | None = None

# The question types the builder understands; anything else is coerced to text.
_VALID_TYPES = {
    "text", "single_choice", "multi_choice", "rating", "number", "email", "distribution"
}
MAX_SUGGESTIONS = 30


def get_client() -> OpenAI:
    """Lazy singleton so importing this module never requires an API key."""
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client


def _answer_hint(question: Question) -> str:
    """A short natural-language hint about what a good answer looks like."""
    t = question.type
    if t in ("single_choice", "multi_choice", "distribution"):
        opts = ", ".join(question.options or [])
        if t == "single_choice":
            return f"They pick one of: {opts}."
        if t == "multi_choice":
            return f"They pick one or more of: {opts}."
        return f"They split 100 points across: {opts}."
    if t == "rating":
        low, high = _rating_range(question)
        return f"They give a whole number from {low} to {high}."
    if t == "number":
        low, high = _number_range(question)
        if low is not None and high is not None:
            return f"They give a number from {low} to {high}."
        if low is not None:
            return f"They give a number that's at least {low}."
        if high is not None:
            return f"They give a number no greater than {high}."
        return "They give a number."
    if t == "email":
        return "They give an email address."
    return "They answer in their own words."


def _config_int(question: Question, key: str, default: int | None = None) -> int | None:
    """Read one integer setting from the question's config (sanitized on write)."""
    config = getattr(question, "config", None) or {}
    value = config.get(key)
    if isinstance(value, bool) or value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _rating_range(question: Question) -> tuple[int, int]:
    """The rating scale for phrasing/parsing — defaults to 1..5."""
    low = _config_int(question, "min_value", 1) or 1
    high = _config_int(question, "max_value", 5) or 5
    return (low, high) if low <= high else (high, low)


def _number_range(question: Question) -> tuple[int | None, int | None]:
    """The optional allowed number range (either bound may be None)."""
    return _config_int(question, "min_value"), _config_int(question, "max_value")


def compose_intro(title: str, description: str, total: int) -> str:
    """A short, warm opening line that states how many questions and the topic."""
    plural = "question" if total == 1 else "questions"
    fallback = (
        f"Hi! You'll answer {total} quick {plural} about “{title}”. "
        "Answer by tapping or typing — ready when you are!"
    )
    try:
        response = get_client().chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Parlo, a warm, concise conversational interviewer. "
                        "Write ONE friendly opening sentence (max 2) that greets the "
                        f"respondent, mentions they'll answer {total} {plural}, and "
                        "names the topic. Do NOT ask the first question yet. Plain "
                        "text only, no quotes around your reply."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f'Title: "{title}"\n'
                        + (f"Context: {description}\n" if description else "")
                        + f"Number of questions: {total}"
                    ),
                },
            ],
            temperature=0.5,
        )
        text = (response.choices[0].message.content or "").strip()
        return text or fallback
    except Exception:
        return fallback


def phrase_question(
    title: str, question: Question, position: int, total: int, is_first: bool
) -> str:
    """A short, warm way to ASK this specific question.

    The widget renders the options/scale, so this stays brief. Non-first turns
    may open with a tiny, varied acknowledgement. Falls back to the raw text.
    """
    fallback = str(question.text)
    ack = (
        "Ask this question directly."
        if is_first
        else "You may open with a brief, varied acknowledgement (e.g. 'Got it.', "
        "'Thanks!', 'Perfect.') then ask the question."
    )
    try:
        response = get_client().chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Parlo, a warm, concise conversational interviewer "
                        f'collecting answers for "{title}". Rephrase the given question '
                        "as ONE short, friendly sentence to ask the respondent now. "
                        f"{ack} The answer widget already shows any options, so do not "
                        "list them all — keep it brief. Plain text only, no quotes."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Question {position} of {total}: {question.text}\n"
                        f"({_answer_hint(question)})"
                    ),
                },
            ],
            temperature=0.4,
        )
        text = (response.choices[0].message.content or "").strip()
        return text or fallback
    except Exception:
        return fallback


def explain_question(title: str, question: Question) -> str:
    """Re-explain / clarify the CURRENT question in simpler words on request."""
    fallback = (
        f"Sure — in other words: {question.text} " + _answer_hint(question)
    )
    try:
        response = get_client().chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Parlo, a warm, patient interviewer. The respondent "
                        "asked for help understanding the current question. Explain "
                        "what it's asking in simpler, plainer words (1-2 sentences), "
                        "then invite them to answer. Plain text only, no quotes."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f'Conversation: "{title}"\nQuestion: {question.text}\n'
                        f"What a good answer looks like: {_answer_hint(question)}"
                    ),
                },
            ],
            temperature=0.4,
        )
        text = (response.choices[0].message.content or "").strip()
        return text or fallback
    except Exception:
        return fallback


def extract_answer(question: Question, user_text: str) -> dict:
    """Parse a TYPED free-text reply into a normalized value for `question`.

    Returns {"value": <normalized|None>, "declined": bool, "needs_help": bool}.
    Never called for `text` questions (those are stored verbatim). On any error
    it returns an all-empty result so the backend simply re-asks.
    """
    empty = {"value": None, "declined": False, "needs_help": False}
    options = question.options or []
    low, high = _rating_range(question)
    num_low, num_high = _number_range(question)
    if num_low is not None and num_high is not None:
        number_shape = f"a number from {num_low} to {num_high}"
    elif num_low is not None:
        number_shape = f"a number that is at least {num_low}"
    elif num_high is not None:
        number_shape = f"a number no greater than {num_high}"
    else:
        number_shape = "a number"
    shape = {
        "single_choice": "exactly one option string from the list",
        "multi_choice": "an array of option strings from the list",
        "rating": f"an integer from {low} to {high}",
        "number": number_shape,
        "email": "the email address as a string",
        "distribution": (
            "an object mapping each option string to its points (all points "
            "summing to 100)"
        ),
    }.get(question.type, "their answer as a string")

    try:
        response = get_client().chat.completions.create(
            model=settings.openai_model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You parse a respondent's reply to ONE survey question into a "
                        "normalized value. Reply ONLY with JSON of this shape:\n"
                        '{"value": <normalized value or null>, '
                        '"declined": <true if they refuse/skip this question>, '
                        '"needs_help": <true if they are confused or asking what the '
                        'question means rather than answering>}\n'
                        f"For THIS question the value must be {shape}. "
                        + (f"Allowed options: {json.dumps(options)}. " if options else "")
                        + "If the reply doesn't contain a usable answer, set value to "
                        "null. Never invent an answer."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Question: {question.text}\nReply: {user_text}",
                },
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
        return {
            "value": data.get("value"),
            "declined": bool(data.get("declined")),
            "needs_help": bool(data.get("needs_help")),
        }
    except Exception:
        return empty


def summarize_answers(title: str, digest: str) -> dict:
    """Ask the model for 3-6 bullet insights + an overall sentiment."""

    response = get_client().chat.completions.create(
        model=settings.openai_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You analyze collected answers for a conversational data-collection "
                    "tool. Reply ONLY with JSON: {\"bullets\": [3-6 short, specific "
                    "insight strings], \"sentiment\": \"positive\"|\"neutral\"|\"mixed\"|"
                    "\"negative\"}. Focus on patterns, standout numbers, and common themes."
                ),
            },
            {
                "role": "user",
                "content": f'Conversation: "{title}"\n\nCollected answers:\n{digest}',
            },
        ],
        response_format={"type": "json_object"},
        temperature=0.3,
    )
    raw = response.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}

    bullets = [str(b) for b in data.get("bullets", []) if str(b).strip()]
    if not bullets:
        bullets = ["Not enough answers yet to draw insights."]
    sentiment = str(data.get("sentiment", "neutral"))
    return {"bullets": bullets[:6], "sentiment": sentiment}


def suggest_questions(topic: str, count: int) -> list[dict]:
    """Draft up to `count` questions about `topic`, spread across question types.

    The raw model output is never trusted: every suggestion is validated and
    repaired here (unknown types → text, choice types need >=2 options, empties
    dropped) so callers get a clean, ready-to-create list. The client groups the
    result by `type`, so there is no separate topical category.
    """

    count = max(1, min(count, MAX_SUGGESTIONS))
    response = get_client().chat.completions.create(
        model=settings.openai_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You help a creator design questions for a conversational "
                    "data-collection form. Given a topic, draft thoughtful, "
                    "non-overlapping questions and spread them across these "
                    "question types, picking whichever best fits each question: "
                    "text (short free text), single_choice, multi_choice, rating "
                    "(a 1-5 scale), number, email, and distribution (the "
                    "respondent splits 100 points across the options). Use a good "
                    "mix of types rather than leaning on just one.\n"
                    "For single_choice, multi_choice, and distribution, fill "
                    "options with at least two real, concise, topic-relevant "
                    "candidate answers (never placeholders like 'Option A'); for "
                    "every other type leave options as an empty array.\n"
                    f"Return exactly {count} questions. Reply ONLY with JSON of "
                    'this exact shape:\n'
                    '{"suggestions": [{"text": string, "type": "text"|'
                    '"single_choice"|"multi_choice"|"rating"|"number"|"email"|'
                    '"distribution", "options": string[], "required": boolean}]}'
                ),
            },
            {
                "role": "user",
                "content": f'Topic: "{topic}"\nDraft {count} questions about it.',
            },
        ],
        response_format={"type": "json_object"},
        temperature=0.6,
    )
    raw = response.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}

    cleaned: list[dict] = []
    for item in data.get("suggestions", []):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text", "")).strip()
        if not text:
            continue

        question_type = item.get("type")
        if question_type not in _VALID_TYPES:
            question_type = "text"

        raw_options = item.get("options")
        options = (
            [str(o).strip() for o in raw_options if str(o).strip()]
            if isinstance(raw_options, list)
            else []
        )
        if question_type in ("single_choice", "multi_choice", "distribution"):
            # A choice/distribution question with too few options is meaningless → text.
            if len(options) < 2:
                question_type = "text"
                options = []
        else:
            options = []

        cleaned.append(
            {
                "text": text[:1000],
                "type": question_type,
                "options": options,
                "required": bool(item.get("required", True)),
            }
        )
        if len(cleaned) >= count:
            break

    return cleaned
