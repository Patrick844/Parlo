"""Database tables.

The shape of the app in five tables:
  User      — a guest workspace, identified by email alone (no password).
  Form      — a "conversation" a creator builds and shares (owned by a User).
  Question  — one item inside a form (ordered by `position`).
  Session   — one respondent's run through a form (their chat transcript).
  Answer    — one validated answer, linked to both a session and a question.
"""

import secrets
import string
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    """UUIDs stored as strings so they work on any database."""
    return str(uuid.uuid4())


def new_slug() -> str:
    """Short random slug for public links, e.g. /f/x7Kp2mQa."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(8))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    """A guest workspace. Email is the identity — there is no password. This is
    a public demo, so entering an email is identification, not authentication."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    # Always stored lowercased + trimmed (normalized in the auth router).
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    forms: Mapped[list["Form"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class Form(Base):
    __tablename__ = "forms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    # Which guest workspace owns this collection. Every admin route scopes to it.
    owner_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    slug: Mapped[str] = mapped_column(String(16), unique=True, index=True, default=new_slug)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True)
    # Target number of questions for this collection, chosen at creation (e.g. 5/10/20).
    size: Mapped[int] = mapped_column(Integer, default=10)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped["User"] = relationship(back_populates="forms")
    questions: Mapped[list["Question"]] = relationship(
        back_populates="form",
        order_by="Question.position",
        cascade="all, delete-orphan",
    )
    sessions: Mapped[list["Session"]] = relationship(
        back_populates="form", cascade="all, delete-orphan"
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    form_id: Mapped[str] = mapped_column(ForeignKey("forms.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)
    # One of: text, single_choice, multi_choice, rating, number, email.
    type: Mapped[str] = mapped_column(String(20), default="text")
    # Only used by the choice types; a JSON array of option strings.
    options: Mapped[list] = mapped_column(JSON, default=list)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    # Per-type answer settings, e.g. {"min_value": 1, "max_value": 10} for a
    # rating, {"min_length": 2, "max_length": 200} for text, {"max_choices": 3}
    # for multi_choice. Only the keys relevant to `type` are kept (sanitized in
    # forms_admin.py). Empty dict means "use the defaults / no limits".
    config: Mapped[dict] = mapped_column(JSON, default=dict)

    form: Mapped[Form] = relationship(back_populates="questions")


class Session(Base):
    """One respondent's chat. `history` holds the full message transcript."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    form_id: Mapped[str] = mapped_column(ForeignKey("forms.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    # A list of {"role": "user"|"assistant", "content": "..."} dicts.
    history: Mapped[list] = mapped_column(JSON, default=list)
    # Ids of OPTIONAL questions the respondent explicitly declined to answer.
    # The "current" question is the first one that is neither answered nor here.
    declined: Mapped[list] = mapped_column(JSON, default=list)
    # A one-shot override: when set to a question id, that question becomes the
    # current one for the NEXT answer (used by "go back / edit"). Cleared after.
    cursor: Mapped[str | None] = mapped_column(String(36), nullable=True, default=None)

    form: Mapped[Form] = relationship(back_populates="sessions")
    answers: Mapped[list["Answer"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class Answer(Base):
    __tablename__ = "answers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    question_id: Mapped[str] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), index=True
    )
    # JSON so one column fits every question type (string, number, or array).
    value: Mapped[object] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped[Session] = relationship(back_populates="answers")
    question: Mapped[Question] = relationship()
