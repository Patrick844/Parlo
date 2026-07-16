"""All OpenAI calls live here.

Three jobs:
  1. `chat_turn` — drive the respondent conversation. The model must answer
     with STRICT JSON ({reply, question_id, answer, done}) so the backend can
     validate and store answers itself.
  2. `summarize_answers` — turn a form's collected answers into a short list
     of insights + an overall sentiment for the dashboard.
  3. `suggest_questions` — draft a batch of questions about a topic, grouped by
     category and tagged with a type, for the builder's AI generator.
"""

import json

from openai import OpenAI

from .config import settings
from .models import Question

_client: OpenAI | None = None

# The question types the builder understands; anything else is coerced to text.
_VALID_TYPES = {"text", "single_choice", "multi_choice", "rating", "number", "email"}
MAX_SUGGESTIONS = 30


def get_client() -> OpenAI:
    """Lazy singleton so importing this module never requires an API key."""
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client


def build_system_prompt(
    title: str, description: str, questions: list[Question], answered_ids: set[str]
) -> str:
    """Everything the model needs to run one interview turn."""

    question_lines = []
    for q in questions:
        entry: dict = {
            "id": q.id,
            "text": q.text,
            "type": q.type,
            "required": q.required,
            "already_answered": q.id in answered_ids,
        }
        if q.type in ("single_choice", "multi_choice"):
            entry["options"] = q.options
        question_lines.append(json.dumps(entry, ensure_ascii=False))

    return (
        "You are Parlo, a warm and concise conversational interviewer. "
        f'You are collecting answers for a conversation titled "{title}".\n'
        + (f"Context from the creator: {description}\n" if description else "")
        + "\nQUESTIONS (ask them in order, one at a time, skipping ones already answered):\n"
        + "\n".join(question_lines)
        + "\n\nRULES:\n"
        "- Keep replies short and friendly (1-3 sentences). Ask exactly one question per turn.\n"
        "- For choice questions, list the options naturally in your reply.\n"
        "- For rating questions, ask for a number from 1 to 5.\n"
        "- When the respondent's latest message answers the current question, extract a\n"
        "  normalized value: single_choice → exactly one option string; multi_choice → an\n"
        "  array of option strings; rating → an integer 1-5; number → a number; email → the\n"
        "  address string; text → their answer as a string.\n"
        "- A respondent may decline an optional (required=false) question; acknowledge and\n"
        "  move on. Gently re-ask required ones.\n"
        "- Never invent answers. If their message is unclear, set answer to null and ask again.\n"
        "- After the final question is answered, thank them briefly and set done to true.\n"
        "\nOUTPUT: respond ONLY with a JSON object of this exact shape:\n"
        '{"reply": string,            // what to say to the respondent next\n'
        ' "question_id": string|null, // the question their LATEST message answered, else null\n'
        ' "answer": any|null,         // the normalized value for that question, else null\n'
        ' "done": boolean}            // true only when the whole conversation is finished'
    )


def chat_turn(system_prompt: str, history: list[dict]) -> dict:
    """One model turn. Returns the parsed JSON dict (with safe fallbacks)."""

    response = get_client().chat.completions.create(
        model=settings.openai_model,
        messages=[{"role": "system", "content": system_prompt}, *history],
        response_format={"type": "json_object"},
        temperature=0.4,
    )
    raw = response.choices[0].message.content or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}

    # Defensive defaults — the backend never assumes the model behaved.
    return {
        "reply": data.get("reply") or "Sorry, could you say that again?",
        "question_id": data.get("question_id"),
        "answer": data.get("answer"),
        "done": bool(data.get("done")),
    }


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
                    "(a 1-5 scale), number, and email. Use a good mix of types "
                    "rather than leaning on just one.\n"
                    "For single_choice and multi_choice, fill options with at "
                    "least two real, concise, topic-relevant candidate answers "
                    "(never placeholders like 'Option A'); for every other type "
                    "leave options as an empty array.\n"
                    f"Return exactly {count} questions. Reply ONLY with JSON of "
                    'this exact shape:\n'
                    '{"suggestions": [{"text": string, "type": "text"|'
                    '"single_choice"|"multi_choice"|"rating"|"number"|"email", '
                    '"options": string[], "required": boolean}]}'
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
        if question_type in ("single_choice", "multi_choice"):
            # A choice question with too few options is meaningless → make it text.
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
