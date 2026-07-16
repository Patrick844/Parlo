"""Public respondent routes — no auth, this is what the shared link hits.

GET  /api/forms/{slug}  → title/description/question count (never answers)
POST /api/chat/{slug}   → one chat turn. The LLM drives the conversation but
                          the SERVER decides what gets stored: every proposed
                          answer is validated in validation.py first.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from .. import llm
from ..database import get_db
from ..models import Answer, Form, Question, Session
from ..schemas import ChatRequest, ChatResponse, PublicForm
from ..validation import validate_answer

router = APIRouter(tags=["public"])

# Safety valve: a conversation that somehow never ends gets cut off here.
MAX_HISTORY_MESSAGES = 80

CLOSED_MESSAGE = "This conversation is no longer collecting answers. Thanks for stopping by!"
ALREADY_DONE_MESSAGE = "This conversation is already wrapped up — thanks again for your answers!"


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

    # ----- first call: create the session and greet -----
    if body.session_id is None:
        session = Session(form_id=form.id, history=[])
        db.add(session)
        db.flush()  # get session.id before the LLM call

        system_prompt = llm.build_system_prompt(
            form.title, form.description, form.questions, answered_ids=set()
        )
        turn = _run_llm(
            system_prompt,
            [{"role": "user", "content": "(The respondent just opened the conversation. "
                                         "Greet them briefly and ask the first question.)"}],
        )
        session.history = [{"role": "assistant", "content": turn["reply"]}]
        db.commit()
        return ChatResponse(session_id=session.id, reply=turn["reply"], done=False)

    # ----- follow-up call: continue an existing session -----
    session = db.get(Session, body.session_id)
    if session is None or session.form_id != form.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.completed:
        return ChatResponse(session_id=session.id, reply=ALREADY_DONE_MESSAGE, done=True)
    if not body.message or not body.message.strip():
        raise HTTPException(status_code=400, detail="Message is required")

    questions_by_id = {q.id: q for q in form.questions}
    answered_ids = {
        a.question_id
        for a in db.scalars(select(Answer).where(Answer.session_id == session.id))
    }

    history = list(session.history) + [{"role": "user", "content": body.message.strip()}]
    system_prompt = llm.build_system_prompt(
        form.title, form.description, form.questions, answered_ids
    )
    turn = _run_llm(system_prompt, history)

    reply: str = turn["reply"]
    done: bool = turn["done"]

    # ----- server-side gatekeeping: validate before storing anything -----
    proposed_qid = turn["question_id"]
    proposed_answer = turn["answer"]
    if proposed_answer is not None and proposed_qid in questions_by_id:
        question = questions_by_id[proposed_qid]
        ok, normalized, error_reply = validate_answer(question, proposed_answer)
        if ok:
            _upsert_answer(db, session.id, question.id, normalized)
            answered_ids.add(question.id)
        else:
            # Invalid → don't store; replace the reply with a deterministic
            # re-ask so the respondent knows exactly what we need.
            reply = error_reply
            done = False

    # The model can't end the conversation while required questions are open.
    if done:
        missing = [
            q for q in form.questions if q.required and q.id not in answered_ids
        ]
        if missing:
            reply = "Almost there — one more thing. " + missing[0].text
            done = False

    # Runaway protection: force-finish extremely long sessions.
    if len(history) + 1 >= MAX_HISTORY_MESSAGES:
        reply = "Thanks so much for your time — that's everything I needed!"
        done = True

    session.history = history + [{"role": "assistant", "content": reply}]
    if done:
        session.completed = True
    db.commit()
    return ChatResponse(session_id=session.id, reply=reply, done=done)


def _run_llm(system_prompt: str, history: list[dict]) -> dict:
    """Call the model, translating provider errors into a clean API error."""
    try:
        return llm.chat_turn(system_prompt, history)
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="The assistant is unavailable right now — please try again in a moment.",
        )


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
