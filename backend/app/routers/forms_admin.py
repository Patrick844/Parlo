"""Admin CRUD for forms and their questions.

Every route is scoped to the signed-in guest (`require_user`): a user only ever
sees or mutates forms whose `owner_id` matches their own id. Cross-user access
is turned into a 404 (via `get_owned_form_or_404` / `get_owned_question_or_404`)
so one workspace can't even probe for another's data.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from .. import llm
from ..auth import require_user
from ..database import get_db
from ..limits import (
    MAX_AI_GENERATIONS_PER_DAY,
    MAX_COLLECTIONS_PER_USER,
    ai_generations_used,
    record_ai_generation,
)
from ..models import Form, Question, Session, User
from ..schemas import (
    FormCreate,
    FormListItem,
    FormOut,
    FormUpdate,
    OkResponse,
    QuestionCreate,
    QuestionOut,
    QuestionUpdate,
    ReorderRequest,
    SuggestedQuestion,
    SuggestQuestionsRequest,
    SuggestQuestionsResponse,
)

# A single form tops out at this many questions.
# A collection's question count is capped per-collection by its own `size`
# (chosen at creation); this is only the hard upper bound the API will accept.
MAX_QUESTIONS = 50

router = APIRouter(prefix="/admin", tags=["admin"])


def get_owned_form_or_404(db: DbSession, form_id: str, user: User) -> Form:
    """Load a form only if it belongs to `user`. A missing form and someone
    else's form both return 404 — no way to tell them apart from outside."""
    form = db.get(Form, form_id, options=[selectinload(Form.questions)])
    if form is None or form.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return form


def get_owned_question_or_404(db: DbSession, question_id: str, user: User) -> Question:
    """Load a question only if its parent form belongs to `user`."""
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    form = db.get(Form, question.form_id)
    if form is None or form.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Question not found")
    return question


# ---------- forms ----------

@router.get("/forms", response_model=list[FormListItem])
def list_forms(
    current_user: User = Depends(require_user), db: DbSession = Depends(get_db)
) -> list[FormListItem]:
    # Only this user's collections — never anyone else's.
    forms = db.scalars(
        select(Form)
        .where(Form.owner_id == current_user.id)
        .options(selectinload(Form.questions))
        .order_by(Form.created_at.desc())
    ).all()

    # One grouped query for session stats instead of one query per form.
    stats = {
        row.form_id: (row.started, row.finished)
        for row in db.execute(
            select(
                Session.form_id,
                func.count(Session.id).label("started"),
                func.sum(cast(Session.completed, Integer)).label("finished"),
            )
            .join(Form, Session.form_id == Form.id)
            .where(Form.owner_id == current_user.id)
            .group_by(Session.form_id)
        )
    }

    items = []
    for form in forms:
        started, finished = stats.get(form.id, (0, 0))
        finished = int(finished or 0)
        items.append(
            FormListItem(
                id=form.id,
                title=form.title,
                slug=form.slug,
                is_open=form.is_open,
                size=form.size,
                created_at=form.created_at,
                question_count=len(form.questions),
                respondents=started,
                completed=finished,
                completion_rate=(finished / started) if started else 0.0,
            )
        )
    return items


@router.post("/forms", response_model=FormOut, status_code=201)
def create_form(
    body: FormCreate,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> Form:
    # Demo guardrail: cap collections per workspace.
    owned = db.scalar(select(func.count(Form.id)).where(Form.owner_id == current_user.id)) or 0
    if owned >= MAX_COLLECTIONS_PER_USER:
        raise HTTPException(
            status_code=403,
            detail=(
                f"Demo limit reached — up to {MAX_COLLECTIONS_PER_USER} collections "
                "per account. Delete one to make room."
            ),
        )
    form = Form(
        owner_id=current_user.id,
        title=body.title,
        description=body.description,
        size=body.size,
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return form


@router.get("/forms/{form_id}", response_model=FormOut)
def get_form(
    form_id: str,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> Form:
    return get_owned_form_or_404(db, form_id, current_user)


@router.patch("/forms/{form_id}", response_model=FormOut)
def update_form(
    form_id: str,
    body: FormUpdate,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> Form:
    form = get_owned_form_or_404(db, form_id, current_user)
    # Only touch the fields the client actually sent.
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(form, field, value)
    db.commit()
    db.refresh(form)
    return form


@router.delete("/forms/{form_id}", response_model=OkResponse)
def delete_form(
    form_id: str,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> OkResponse:
    form = get_owned_form_or_404(db, form_id, current_user)
    db.delete(form)
    db.commit()
    return OkResponse()


# ---------- questions ----------

@router.post("/forms/{form_id}/questions", response_model=QuestionOut, status_code=201)
def add_question(
    form_id: str,
    body: QuestionCreate,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> Question:
    form = get_owned_form_or_404(db, form_id, current_user)
    if len(form.questions) >= form.size:
        raise HTTPException(
            status_code=400,
            detail=f"This collection is set to {form.size} questions and is already full.",
        )
    _check_options(body.type, body.options)
    # New questions go to the TOP so the creator sees them immediately (a blank
    # appended to the bottom of a long list is easy to miss). Shift the rest down.
    for existing in form.questions:
        existing.position += 1
    question = Question(
        form_id=form.id,
        position=0,
        text=body.text,
        type=body.type,
        options=body.options,
        required=body.required,
        config=_sanitize_config(body.type, body.config),
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.patch("/questions/{question_id}", response_model=QuestionOut)
def update_question(
    question_id: str,
    body: QuestionUpdate,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> Question:
    question = get_owned_question_or_404(db, question_id, current_user)
    changes = body.model_dump(exclude_unset=True)
    new_type = changes.get("type", question.type)
    new_options = changes.get("options", question.options)
    _check_options(new_type, new_options)
    # Re-sanitize config against the effective type. If the type changed but no
    # new config was sent, re-filter the existing one so stale keys are dropped.
    if "config" in changes or "type" in changes:
        raw_config = changes.get("config", question.config or {})
        changes["config"] = _sanitize_config(new_type, raw_config or {})
    for field, value in changes.items():
        setattr(question, field, value)
    db.commit()
    db.refresh(question)
    return question


@router.delete("/questions/{question_id}", response_model=OkResponse)
def delete_question(
    question_id: str,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> OkResponse:
    question = get_owned_question_or_404(db, question_id, current_user)
    form_id = question.form_id
    db.delete(question)
    db.flush()
    _renumber(db, form_id)
    db.commit()
    return OkResponse()


@router.put("/forms/{form_id}/questions/reorder", response_model=list[QuestionOut])
def reorder_questions(
    form_id: str,
    body: ReorderRequest,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> list[Question]:
    form = get_owned_form_or_404(db, form_id, current_user)
    by_id = {q.id: q for q in form.questions}
    if set(body.question_ids) != set(by_id):
        raise HTTPException(status_code=400, detail="Ids must match this conversation's questions")
    for position, question_id in enumerate(body.question_ids):
        by_id[question_id].position = position
    db.commit()
    return sorted(form.questions, key=lambda q: q.position)


# ---------- AI question suggestions ----------

@router.post("/forms/{form_id}/suggest-questions", response_model=SuggestQuestionsResponse)
def suggest_questions(
    form_id: str,
    body: SuggestQuestionsRequest,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> SuggestQuestionsResponse:
    """Draft questions about a topic. Nothing is persisted — the creator picks
    which suggestions to keep, and those go through the normal create path."""
    form = get_owned_form_or_404(db, form_id, current_user)
    remaining = form.size - len(form.questions)
    if remaining <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"This collection is set to {form.size} questions and is already full.",
        )

    # Demo guardrail: cap AI generations per user per day (protects the bill).
    if ai_generations_used(current_user.id) >= MAX_AI_GENERATIONS_PER_DAY:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Demo limit reached — up to {MAX_AI_GENERATIONS_PER_DAY} AI generations "
                "per day. Please try again tomorrow."
            ),
        )

    # Clamp the request to what the form can still hold.
    effective = min(body.count, remaining)
    try:
        drafts = llm.suggest_questions(body.topic, effective)
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="Couldn't generate suggestions right now — please try again.",
        )

    # Count the spend only after a successful call, so a failed OpenAI request
    # doesn't burn the user's daily quota.
    record_ai_generation(current_user.id)
    suggestions = [SuggestedQuestion(**draft) for draft in drafts]
    return SuggestQuestionsResponse(count=effective, suggestions=suggestions)


# Which config keys are meaningful for each question type. Anything else the
# client sends is dropped so a question never carries settings it can't use.
_CONFIG_KEYS: dict[str, tuple[str, ...]] = {
    "rating": ("min_value", "max_value"),
    "text": ("min_length", "max_length"),
    "number": ("min_value", "max_value"),
    "multi_choice": ("max_choices",),
}


def _coerce_int(value: object) -> int | None:
    """Best-effort int coercion; returns None for anything non-numeric."""
    if isinstance(value, bool):  # bool is an int subclass — reject it explicitly
        return None
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _sanitize_config(question_type: str, raw: dict) -> dict:
    """Keep only the keys relevant to `question_type`, coerce them to ints, and
    drop nonsense. min>max pairs are swapped so the stored range is always sane.
    Returns a clean dict (possibly empty) safe to persist and to validate against."""
    allowed = _CONFIG_KEYS.get(question_type, ())
    if not allowed or not isinstance(raw, dict):
        return {}

    clean: dict = {}
    for key in allowed:
        coerced = _coerce_int(raw.get(key))
        if coerced is not None:
            clean[key] = coerced

    # Normalize the min/max pairs so a swapped range never gets stored.
    for lo, hi in (("min_value", "max_value"), ("min_length", "max_length")):
        if lo in clean and hi in clean and clean[lo] > clean[hi]:
            clean[lo], clean[hi] = clean[hi], clean[lo]

    # Lengths and choice counts can't be negative; a min_length of 0 == no min.
    for key in ("min_length", "max_length", "max_choices"):
        if key in clean and clean[key] < 0:
            del clean[key]
    if clean.get("min_length") == 0:
        del clean["min_length"]
    if question_type == "multi_choice" and clean.get("max_choices") == 0:
        del clean["max_choices"]

    return clean


def _check_options(question_type: str, options: list) -> None:
    """Choice and distribution questions need at least two options; others ignore them."""
    if question_type in ("single_choice", "multi_choice", "distribution") and len(options or []) < 2:
        raise HTTPException(
            status_code=400, detail="Choice and distribution questions need at least two options"
        )


def _renumber(db: DbSession, form_id: str) -> None:
    """Keep positions dense (0,1,2,…) after a delete."""
    questions = db.scalars(
        select(Question).where(Question.form_id == form_id).order_by(Question.position)
    ).all()
    for index, question in enumerate(questions):
        question.position = index
