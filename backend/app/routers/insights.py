"""Admin insights: per-question aggregates, CSV export, and the AI summary."""

import csv
import io
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from .. import llm
from ..auth import require_user
from ..database import get_db
from ..models import Answer, Form, Session, User
from ..schemas import DayCount, InsightsOut, OptionAverage, QuestionInsight, SummaryOut

router = APIRouter(prefix="/admin", tags=["insights"])


def _load_form(db: DbSession, form_id: str, user: User) -> Form:
    """Load a form only if it belongs to `user`; someone else's form 404s."""
    form = db.get(Form, form_id, options=[selectinload(Form.questions)])
    if form is None or form.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return form


def _form_answers(db: DbSession, form_id: str) -> list[Answer]:
    """All answers for a form, joined through its sessions."""
    return list(
        db.scalars(
            select(Answer)
            .join(Session, Answer.session_id == Session.id)
            .where(Session.form_id == form_id)
        )
    )


@router.get("/forms/{form_id}/insights", response_model=InsightsOut)
def insights(
    form_id: str,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> InsightsOut:
    form = _load_form(db, form_id, current_user)
    sessions = db.scalars(select(Session).where(Session.form_id == form.id)).all()
    answers = _form_answers(db, form.id)
    answers_by_question: dict[str, list[Answer]] = {}
    for answer in answers:
        answers_by_question.setdefault(answer.question_id, []).append(answer)

    question_insights = []
    for question in form.questions:
        q_answers = answers_by_question.get(question.id, [])
        insight = QuestionInsight(
            question_id=question.id,
            text=question.text,
            type=question.type,  # type: ignore[arg-type]
            answer_count=len(q_answers),
        )

        if question.type in ("single_choice", "multi_choice"):
            # Seed with the configured options so zero-count bars still show.
            counts = {str(option): 0 for option in question.options or []}
            for answer in q_answers:
                values = answer.value if isinstance(answer.value, list) else [answer.value]
                for value in values:
                    key = str(value)
                    counts[key] = counts.get(key, 0) + 1
            insight.counts = counts

        elif question.type in ("rating", "number"):
            numbers: list[float] = []
            counts: dict[str, int] = (
                {str(n): 0 for n in range(1, 6)} if question.type == "rating" else {}
            )
            for answer in q_answers:
                try:
                    number = float(answer.value)  # type: ignore[arg-type]
                except (TypeError, ValueError):
                    continue
                numbers.append(number)
                key = str(int(number)) if number.is_integer() else str(number)
                counts[key] = counts.get(key, 0) + 1
            insight.counts = counts
            insight.average = round(sum(numbers) / len(numbers), 2) if numbers else None

        elif question.type == "distribution":
            # Mean points allocated to each option across all answers for this
            # question (an answer omitting an option counts it as 0).
            options = [str(option) for option in question.options or []]
            totals = {option: 0.0 for option in options}
            for answer in q_answers:
                if not isinstance(answer.value, dict):
                    continue
                for option in options:
                    try:
                        totals[option] += float(answer.value.get(option, 0) or 0)
                    except (TypeError, ValueError):
                        continue
            n = len(q_answers)
            insight.distribution = [
                OptionAverage(option=option, avg=round(totals[option] / n, 2) if n else 0.0)
                for option in options
            ]

        else:  # text / email → just list the values
            insight.values = [str(a.value) for a in q_answers]

        question_insights.append(insight)

    started = len(sessions)
    finished = sum(1 for s in sessions if s.completed)

    return InsightsOut(
        form_id=form.id,
        title=form.title,
        is_open=form.is_open,
        sessions_started=started,
        sessions_completed=finished,
        completion_rate=(finished / started) if started else 0.0,
        answers_by_day=_answers_by_day(answers),
        questions=question_insights,
    )


def _answers_by_day(answers: list[Answer]) -> list[DayCount]:
    """Answer counts for each of the last 14 days (zero-filled)."""
    today = datetime.now(timezone.utc).date()
    days = [today - timedelta(days=offset) for offset in range(13, -1, -1)]
    counts = {day.isoformat(): 0 for day in days}
    for answer in answers:
        key = answer.created_at.date().isoformat()
        if key in counts:
            counts[key] += 1
    return [DayCount(date=key, count=value) for key, value in counts.items()]


@router.get("/forms/{form_id}/export.csv")
def export_csv(
    form_id: str,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> StreamingResponse:
    """One row per session, one column per question."""
    form = _load_form(db, form_id, current_user)
    sessions = db.scalars(
        select(Session)
        .where(Session.form_id == form.id)
        .order_by(Session.started_at)
        .options(selectinload(Session.answers))
    ).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["session_id", "started_at", "completed"] + [q.text for q in form.questions]
    )
    for session in sessions:
        by_question = {a.question_id: a.value for a in session.answers}
        row = [session.id, session.started_at.isoformat(), session.completed]
        for question in form.questions:
            value = by_question.get(question.id, "")
            # Multi-choice arrays become "A; B" so the CSV stays one cell wide.
            row.append("; ".join(str(v) for v in value) if isinstance(value, list) else value)
        writer.writerow(row)

    buffer.seek(0)
    filename = f"parlo-{form.slug}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/forms/{form_id}/summarize", response_model=SummaryOut)
def summarize(
    form_id: str,
    current_user: User = Depends(require_user),
    db: DbSession = Depends(get_db),
) -> SummaryOut:
    form = _load_form(db, form_id, current_user)
    # AI insights run on COMPLETE data only: the collection must be closed first.
    # (The charts stay viewable live; this just gates the paid summary call.)
    if form.is_open:
        raise HTTPException(
            status_code=409,
            detail="Close the collection to answers first, then generate AI insights on the complete data.",
        )
    answers = _form_answers(db, form.id)
    if not answers:
        return SummaryOut(bullets=["No answers collected yet."], sentiment="neutral")

    # Build a compact digest: each question followed by its answers.
    answers_by_question: dict[str, list] = {}
    for answer in answers:
        answers_by_question.setdefault(answer.question_id, []).append(answer.value)

    sections = []
    for question in form.questions:
        values = answers_by_question.get(question.id, [])
        if not values:
            continue
        rendered = json.dumps(values, ensure_ascii=False)
        # Keep the prompt bounded even with lots of respondents.
        sections.append(f"Q: {question.text}\nA: {rendered[:4000]}")

    try:
        result = llm.summarize_answers(form.title, "\n\n".join(sections))
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="Couldn't generate the summary right now — please try again.",
        )
    return SummaryOut(bullets=result["bullets"], sentiment=result["sentiment"])
