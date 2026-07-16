"""Email-only guest auth.

POST /api/auth/enter — get-or-create a workspace for an email, return a JWT.
GET  /api/auth/me    — the current guest plus their demo usage (protected).

No password anywhere: entering an email identifies a workspace, it doesn't
authenticate a person. That's intentional for a public demo.
"""

import re

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..auth import create_access_token, require_user
from ..database import get_db
from ..limits import (
    MAX_AI_GENERATIONS_PER_DAY,
    MAX_COLLECTIONS_PER_USER,
    ai_generations_used,
    check_enter_rate_limit,
)
from ..models import Form, User
from ..schemas import EnterRequest, MeResponse, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])

# Deliberately loose: enough to reject typos and junk, not to gatekeep. There's
# no verification email — this is a demo, so "looks like an email" is the bar.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.post("/enter", response_model=TokenResponse)
def enter(body: EnterRequest, request: Request, db: DbSession = Depends(get_db)) -> TokenResponse:
    """Validate + normalize the email, get-or-create the user, return a JWT."""
    # Per-IP rate limit (in-memory; resets on server restart — see limits.py).
    ip = request.client.host if request.client else "unknown"
    if not check_enter_rate_limit(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many sign-ins from here — please try again in a little while.",
        )

    email = (body.email or "").strip().lower()
    if len(email) > 320 or not _EMAIL_RE.match(email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please enter a valid email address.",
        )

    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email)
        db.add(user)
        db.commit()
        db.refresh(user)

    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=MeResponse)
def me(
    current_user: User = Depends(require_user), db: DbSession = Depends(get_db)
) -> MeResponse:
    collections_used = (
        db.scalar(select(func.count(Form.id)).where(Form.owner_id == current_user.id)) or 0
    )
    return MeResponse(
        email=current_user.email,
        collections_used=collections_used,
        collections_max=MAX_COLLECTIONS_PER_USER,
        ai_used_today=ai_generations_used(current_user.id),
        ai_max_per_day=MAX_AI_GENERATIONS_PER_DAY,
    )
