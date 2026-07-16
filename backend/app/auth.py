"""Email-only guest auth (JWT).

A guest enters their email at /api/auth/enter and gets a short-lived JWT whose
`sub` is their user id. This is IDENTIFICATION, not authentication — it's a
public demo, so there is no password anywhere. Every /api/admin/* route depends
on `require_user`, which loads the User the token points at.
"""

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session as DbSession

from .config import settings
from .database import get_db
from .models import User

ALGORITHM = "HS256"

# auto_error=False lets us return our own 401 message instead of FastAPI's.
bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(user_id: str) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.token_expire_minutes)
    payload = {"sub": user_id, "exp": expires}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: DbSession = Depends(get_db),
) -> User:
    """Dependency: decode the JWT, load the User it names, and return it.
    Raises 401 for a missing, invalid, or expired token, or an unknown user."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    try:
        payload = jwt.decode(
            credentials.credentials, settings.secret_key, algorithms=[ALGORITHM]
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return user
