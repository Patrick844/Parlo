"""Public respondent routes — no auth, this is what the shared link hits.

GET  /api/forms/{slug}  → title/description/question count (never answers)
POST /api/chat/{slug}   → one chat turn.

The BACKEND owns the flow: it decides which question is current (the first one
not yet answered and not declined, unless a one-shot `cursor` overrides it for
an edit), validates every answer in validation.py, and computes progress and
completion itself. The LLM is used only to phrase questions and to parse typed
free-text replies — it never decides what is stored or when the chat is done.
"""

import json
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from .. import llm
from ..database import get_db
from ..models import Answer, Form, Question, Session
from ..schemas import ChatProgress, ChatRequest, ChatResponse, CurrentQuestion, PublicForm
from ..validation import validate_answer

router = APIRouter(tags=["public"])

# Safety valve: a conversation that somehow never ends gets cut off here.
MAX_HISTORY_MESSAGES = 120

CLOSED_MESSAGE = "This conversation is no longer collecting answers. Thanks for stopping by!"
ALREADY_DONE_MESSAGE = "This conversation is already wrapped up — thanks again for your answers!"
CLOSING_MESSAGE = "That's everything — thank you so much for your time!"

# Typed clarification requests that should re-explain, not answer, the question.
_HELP_PHRASES = (
    "what do you mean",
    "what does this mean",
    "i don't understand",
    "i dont understand",
    "not sure what",
    "explain",
    "clarify",
    "confused",
    "rephrase",
)


def _get_open_form(db: DbSession, slug: str) -> Form:
    form = db.scalar(
        select(Form).where(Form.slug == slug).options(selectinload(Form.questions))
    )
    if form is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return form


@router.get("/forms/{slug}", response_model=PublicForm)
def public_form(slug: str, db: DbSession = Depends(get_db)) -> PublicForm:
    form = _get_open_form(db, slug)
    return PublicForm(
        title=form.title,
        description=form.description,
        question_count=len(form.questions),
        is_open=form.is_open,
    )


@router.post("/chat/{slug}", response_model=ChatResponse)
def chat(slug: str, body: ChatRequest, db: DbSession = Depends(get_db)) -> ChatResponse:
    form = _get_open_form(db, slug)
    if not form.is_open:
        raise HTTPException(status_code=410, detail=CLOSED_MESSAGE)
    if not form.questions:
        raise HTTPException(status_code=400, detail="This conversation has no questions yet.")

    questions = list(form.questions)  # already ordered by position
    total = len(questions)

    # ----- first call: create the session, greet, present question 1 -----
    if body.session_id is None:
        session = Session(form_id=form.id, history=[], declined=[], cursor=None)
        db.add(session)
        db.flush()

        first = questions[0]
        intro = llm.compose_intro(form.title, form.description, total)
        ask = llm.phrase_question(form.title, first, 1, total, is_first=True)
        reply = f"{intro}\n\n{ask}"

        session.history = [{"role": "assistant", "content": reply}]
        db.commit()
        return ChatResponse(
            session_id=session.id,
            reply=reply,
            question=_question_out(questions, first),
            progress=ChatProgress(answered=0, total=total),
            done=False,
        )

    # ----- follow-up call: continue an existing session -----
    session = db.get(Session, body.session_id)
    if session is None or session.form_id != form.id:
        raise HTTPException(status_code=404, detail="Session not found")

    answered = {
        a.question_id: a.value
        for a in db.scalars(select(Answer).where(Answer.session_id == session.id))
    }
    if session.completed:
        return ChatResponse(
            session_id=session.id,
            reply=ALREADY_DONE_MESSAGE,
            question=None,
            progress=ChatProgress(answered=len(answered), total=total),
            done=True,
        )

    by_id = {q.id: q for q in questions}
    declined: list[str] = list(session.declined or [])

    # ----- explicit "go back / edit" via the sidebar (goto_question_id) -----
    if body.goto_question_id:
        target = by_id.get(body.goto_question_id)
        if target is None or target.id not in answered:
            raise HTTPException(status_code=400, detail="That question can't be edited yet.")
        return _begin_edit(db, session, questions, target, answered, total)

    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")

    # Which question are we on? A cursor (set by an edit) wins for one turn.
    current = _resolve_current(questions, answered, declined, session.cursor)
    if current is None:
        # Nothing left to answer — finish up.
        session.completed = True
        db.commit()
        return _respond(session, CLOSING_MESSAGE, None, questions, answered, done=True)

    history = list(session.history) + [{"role": "user", "content": message}]

    # ----- "help": re-explain the current question, don't consume an answer -----
    if _looks_like_help(message):
        reply = llm.explain_question(form.title, current)
        return _finish_turn(db, session, history, reply, current, questions, answered)

    # ----- typed "go back to question N" / "edit question N" command -----
    goto_id = _parse_goto_command(message, questions, answered)
    if goto_id:
        session.history = history  # keep the transcript
        return _begin_edit(db, session, questions, by_id[goto_id], answered, total)

    # ----- otherwise: treat the message as an answer to the current question -----
    candidate = _coerce(current, message)
    ok, normalized, error = validate_answer(current, candidate)
    declined_it = False

    # Free text that didn't validate → let the model parse / detect intent.
    if not ok and current.type != "text":
        parsed = llm.extract_answer(current, message)
        if parsed.get("needs_help"):
            reply = llm.explain_question(form.title, current)
            return _finish_turn(db, session, history, reply, current, questions, answered)
        if parsed.get("declined") and not current.required:
            declined_it = True
        elif parsed.get("value") is not None:
            ok, normalized, error = validate_answer(current, parsed["value"])

    if declined_it:
        if current.id not in declined:
            declined.append(current.id)
        session.declined = declined
        if session.cursor == current.id:
            session.cursor = None
    elif ok:
        _upsert_answer(db, session.id, current.id, normalized)
        answered[current.id] = normalized
        if session.cursor == current.id:
            session.cursor = None  # edit applied → resume normal flow
    else:
        # Invalid → keep the same question and re-ask deterministically.
        reply = error or "Sorry, I didn't quite catch that — could you try again?"
        return _finish_turn(db, session, history, reply, current, questions, answered)

    # ----- advance to the next unanswered / undeclined question -----
    nxt = _resolve_current(questions, answered, declined, None)
    if nxt is None:
        session.completed = True
        return _finish_turn(db, session, history, CLOSING_MESSAGE, None, questions, answered)

    reply = llm.phrase_question(
        form.title, nxt, _position_of(questions, nxt), total, is_first=False
    )
    return _finish_turn(db, session, history, reply, nxt, questions, answered)


# --------------------------------------------------------------------------- #
# Flow helpers
# --------------------------------------------------------------------------- #

def _resolve_current(
    questions: list[Question], answered: dict, declined: list[str], cursor: str | None
) -> Question | None:
    """The question to answer now: cursor override, else first open one."""
    if cursor:
        for q in questions:
            if q.id == cursor:
                return q
    for q in questions:
        if q.id not in answered and q.id not in declined:
            return q
    return None


def _position_of(questions: list[Question], question: Question) -> int:
    """1-based display position of a question within the form."""
    for i, q in enumerate(questions):
        if q.id == question.id:
            return i + 1
    return 1


def _question_out(questions: list[Question], question: Question) -> CurrentQuestion:
    return CurrentQuestion(
        id=question.id,
        text=question.text,
        type=question.type,
        options=list(question.options or []),
        required=question.required,
        config=dict(question.config or {}),
        position=_position_of(questions, question),
        total=len(questions),
    )


def _begin_edit(
    db: DbSession,
    session: Session,
    questions: list[Question],
    target: Question,
    answered: dict,
    total: int,
) -> ChatResponse:
    """Point the cursor at an already-answered question and invite a new answer."""
    session.cursor = target.id
    current_value = _format_value(target, answered.get(target.id))
    pos = _position_of(questions, target)
    reply = (
        f"Sure — your current answer to question {pos} "
        f'("{target.text}") is: {current_value}. What would you like it to be?'
    )
    session.history = list(session.history) + [{"role": "assistant", "content": reply}]
    db.commit()
    return ChatResponse(
        session_id=session.id,
        reply=reply,
        question=_question_out(questions, target),
        progress=ChatProgress(answered=len(answered), total=total),
        done=False,
    )


def _finish_turn(
    db: DbSession,
    session: Session,
    history: list[dict],
    reply: str,
    question: Question | None,
    questions: list[Question],
    answered: dict,
) -> ChatResponse:
    """Persist the transcript + flags and build the response in one place."""
    history = history + [{"role": "assistant", "content": reply}]

    done = question is None
    # Runaway protection: force-finish absurdly long sessions.
    if not done and len(history) >= MAX_HISTORY_MESSAGES:
        reply = "Thanks so much for your time — that's everything I needed!"
        history[-1] = {"role": "assistant", "content": reply}
        question = None
        done = True

    session.history = history
    if done:
        session.completed = True
        session.cursor = None
    db.commit()
    return _respond(session, reply, question, questions, answered, done=done)


def _respond(
    session: Session,
    reply: str,
    question: Question | None,
    questions: list[Question],
    answered: dict,
    done: bool,
) -> ChatResponse:
    return ChatResponse(
        session_id=session.id,
        reply=reply,
        question=_question_out(questions, question) if question else None,
        progress=ChatProgress(answered=len(answered), total=len(questions)),
        done=done,
    )


# --------------------------------------------------------------------------- #
# Parsing / detection helpers
# --------------------------------------------------------------------------- #

def _coerce(question: Question, message: str) -> object:
    """Best-effort turn a raw widget/typed string into a value validate_answer
    can check. Multi-choice / distribution widgets submit JSON; everything else
    is fine as a plain string (validate_answer coerces numbers itself)."""
    if question.type in ("multi_choice", "distribution"):
        parsed = _try_json(message)
        if parsed is not None:
            return parsed
    return message


def _try_json(text: str) -> object | None:
    try:
        value = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return value if isinstance(value, (list, dict)) else None


def _looks_like_help(message: str) -> bool:
    low = message.strip().lower()
    if low in ("help", "?", "help?", "help me"):
        return True
    return any(phrase in low for phrase in _HELP_PHRASES)


def _parse_goto_command(
    message: str, questions: list[Question], answered: dict
) -> str | None:
    """Map a typed 'go back to question N' / 'edit question N' to a question id."""
    low = message.lower()
    if not any(k in low for k in ("go back", "back to", "edit", "change", "revisit", "previous")):
        return None
    match = re.search(r"question\s*#?\s*(\d+)", low) or re.search(r"\b(\d+)\b", low)
    if not match:
        return None
    n = int(match.group(1))
    if 1 <= n <= len(questions):
        target = questions[n - 1]
        if target.id in answered:
            return target.id
    return None


def _format_value(question: Question, value: object) -> str:
    """Render a stored answer back to the respondent when they edit it."""
    if value is None:
        return "—"
    if question.type == "distribution" and isinstance(value, dict):
        return ", ".join(f"{k}: {v}" for k, v in value.items())
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


def _upsert_answer(db: DbSession, session_id: str, question_id: str, value: object) -> None:
    """One answer per (session, question) — a corrected answer replaces the old one."""
    existing = db.scalar(
        select(Answer).where(
            Answer.session_id == session_id, Answer.question_id == question_id
        )
    )
    if existing is not None:
        existing.value = value
    else:
        db.add(Answer(session_id=session_id, question_id=question_id, value=value))
