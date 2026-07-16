"""Admin CRUD for forms and their questions. Every route requires the JWT."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from .. import llm
from ..auth import require_admin
from ..database import get_db
from ..models import Form, Question, Session
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
MAX_QUESTIONS = 30

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def get_form_or_404(db: DbSession, form_id: str) -> Form:
    form = db.get(Form, form_id, options=[selectinload(Form.questions)])
    if form is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return form


# ---------- forms ----------

@router.get("/forms", response_model=list[FormListItem])
def list_forms(db: DbSession = Depends(get_db)) -> list[FormListItem]:
    forms = db.scalars(
        select(Form).options(selectinload(Form.questions)).order_by(Form.created_at.desc())
    ).all()

    # One grouped query for session stats instead of one query per form.
    stats = {
        row.form_id: (row.started, row.finished)
        for row in db.execute(
            select(
                Session.form_id,
                func.count(Session.id).label("started"),
                func.sum(cast(Session.completed, Integer)).label("finished"),
            ).group_by(Session.form_id)
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
                created_at=form.created_at,
                question_count=len(form.questions),
                respondents=started,
                completed=finished,
                completion_rate=(finished / started) if started else 0.0,
            )
        )
    return items


@router.post("/forms", response_model=FormOut, status_code=201)
def create_form(body: FormCreate, db: DbSession = Depends(get_db)) -> Form:
    form = Form(title=body.title, description=body.description)
    db.add(form)
    db.commit()
    db.refresh(form)
    return form


@router.get("/forms/{form_id}", response_model=FormOut)
def get_form(form_id: str, db: DbSession = Depends(get_db)) -> Form:
    return get_form_or_404(db, form_id)


@router.patch("/forms/{form_id}", response_model=FormOut)
def update_form(form_id: str, body: FormUpdate, db: DbSession = Depends(get_db)) -> Form:
    form = get_form_or_404(db, form_id)
    # Only touch the fields the client actually sent.
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(form, field, value)
    db.commit()
    db.refresh(form)
    return form


@router.delete("/forms/{form_id}", response_model=OkResponse)
def delete_form(form_id: str, db: DbSession = Depends(get_db)) -> OkResponse:
    form = get_form_or_404(db, form_id)
    db.delete(form)
    db.commit()
    return OkResponse()


# ---------- questions ----------

@router.post("/forms/{form_id}/questions", response_model=QuestionOut, status_code=201)
def add_question(
    form_id: str, body: QuestionCreate, db: DbSession = Depends(get_db)
) -> Question:
    form = get_form_or_404(db, form_id)
    if len(form.questions) >= MAX_QUESTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"A conversation can have at most {MAX_QUESTIONS} questions.",
        )
    _check_options(body.type, body.options)
    question = Question(
        form_id=form.id,
        position=len(form.questions),  # append at the end
        text=body.text,
        type=body.type,
        options=body.options,
        required=body.required,
    )
    db.add(question)
    db.commit()
    db.refresh(question)
    return question


@router.patch("/questions/{question_id}", response_model=QuestionOut)
def update_question(
    question_id: str, body: QuestionUpdate, db: DbSession = Depends(get_db)
) -> Question:
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    changes = body.model_dump(exclude_unset=True)
    new_type = changes.get("type", question.type)
    new_options = changes.get("options", question.options)
    _check_options(new_type, new_options)
    for field, value in changes.items():
        setattr(question, field, value)
    db.commit()
    db.refresh(question)
    return question


@router.delete("/questions/{question_id}", response_model=OkResponse)
def delete_question(question_id: str, db: DbSession = Depends(get_db)) -> OkResponse:
    question = db.get(Question, question_id)
    if question is None:
        raise HTTPException(status_code=404, detail="Question not found")
    form_id = question.form_id
    db.delete(question)
    db.flush()
    _renumber(db, form_id)
    db.commit()
    return OkResponse()


@router.put("/forms/{form_id}/questions/reorder", response_model=list[QuestionOut])
def reorder_questions(
    form_id: str, body: ReorderRequest, db: DbSession = Depends(get_db)
) -> list[Question]:
    form = get_form_or_404(db, form_id)
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
    form_id: str, body: SuggestQuestionsRequest, db: DbSession = Depends(get_db)
) -> SuggestQuestionsResponse:
    """Draft questions about a topic. Nothing is persisted — the creator picks
    which suggestions to keep, and those go through the normal create path."""
    form = get_form_or_404(db, form_id)
    remaining = MAX_QUESTIONS - len(form.questions)
    if remaining <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"This conversation already has the maximum of {MAX_QUESTIONS} questions.",
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

    suggestions = [SuggestedQuestion(**draft) for draft in drafts]
    return SuggestQuestionsResponse(count=effective, suggestions=suggestions)


def _check_options(question_type: str, options: list) -> None:
    """Choice questions need at least two options; other types ignore them."""
    if question_type in ("single_choice", "multi_choice") and len(options or []) < 2:
        raise HTTPException(
            status_code=400, detail="Choice questions need at least two options"
        )


def _renumber(db: DbSession, form_id: str) -> None:
    """Keep positions dense (0,1,2,…) after a delete."""
    questions = db.scalars(
        select(Question).where(Question.form_id == form_id).order_by(Question.position)
    ).all()
    for index, question in enumerate(questions):
        question.position = index
