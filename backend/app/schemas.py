"""Pydantic schemas — the API contract.

Every route reads its body through one of these and returns another, so the
frontend always knows exactly what shape to expect.
"""

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

QuestionType = Literal[
    "text", "single_choice", "multi_choice", "rating", "number", "email", "distribution"
]


# ---------- auth ----------

class LoginRequest(BaseModel):
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---------- questions ----------

class QuestionCreate(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    type: QuestionType = "text"
    options: list[str] = []
    required: bool = True


class QuestionUpdate(BaseModel):
    text: Optional[str] = Field(default=None, min_length=1, max_length=1000)
    type: Optional[QuestionType] = None
    options: Optional[list[str]] = None
    required: Optional[bool] = None
    position: Optional[int] = None


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    position: int
    text: str
    type: QuestionType
    options: list[str]
    required: bool


class ReorderRequest(BaseModel):
    """Full ordered list of question ids; positions are rewritten to match."""

    question_ids: list[str]


# ---------- AI question suggestions ----------

class SuggestQuestionsRequest(BaseModel):
    """Creator asks the model for `count` questions about a free-text topic."""

    topic: str = Field(min_length=1, max_length=200)
    count: int = Field(ge=1, le=30)


class SuggestedQuestion(BaseModel):
    """One AI-suggested question — the creator cherry-picks which to keep.

    The client groups these by `type`; there is no separate topical category.
    """

    text: str
    type: QuestionType = "text"
    options: list[str] = []
    required: bool = True


class SuggestQuestionsResponse(BaseModel):
    # `count` is the effective number asked for (clamped to remaining capacity).
    count: int
    suggestions: list[SuggestedQuestion]


# ---------- forms ----------

class FormCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""


class FormUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    is_open: Optional[bool] = None


class FormOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str
    slug: str
    is_open: bool
    created_at: datetime
    questions: list[QuestionOut]


class FormListItem(BaseModel):
    """Dashboard row: a form plus its headline numbers."""

    id: str
    title: str
    slug: str
    is_open: bool
    created_at: datetime
    question_count: int
    respondents: int          # sessions started
    completed: int            # sessions finished
    completion_rate: float    # 0..1


# ---------- public (respondent) ----------

class PublicForm(BaseModel):
    """What a respondent sees before starting — never any answers."""

    title: str
    description: str
    question_count: int
    is_open: bool


class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: Optional[str] = Field(default=None, max_length=4000)


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    done: bool


# ---------- insights ----------

class OptionAverage(BaseModel):
    """One row of a distribution question's mean allocation, e.g. Salary → 37.5."""

    option: str
    avg: float


class QuestionInsight(BaseModel):
    question_id: str
    text: str
    type: QuestionType
    answer_count: int
    # choice / rating / number → {"value": count, ...}
    counts: dict[str, int] = {}
    # rating / number only
    average: Optional[float] = None
    # text / email → the raw values
    values: list[str] = []
    # distribution → average points allocated to each option
    distribution: list[OptionAverage] = []


class DayCount(BaseModel):
    date: str  # YYYY-MM-DD
    count: int


class InsightsOut(BaseModel):
    form_id: str
    title: str
    sessions_started: int
    sessions_completed: int
    completion_rate: float
    answers_by_day: list[DayCount]  # last 14 days
    questions: list[QuestionInsight]


class SummaryOut(BaseModel):
    bullets: list[str]
    sentiment: str


# ---------- misc ----------

class OkResponse(BaseModel):
    ok: bool = True


class AnyValue(BaseModel):
    """Wrapper for endpoints that echo arbitrary JSON values."""

    value: Any
