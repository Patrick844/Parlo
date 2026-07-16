"""POST /api/auth/login — trade the admin password for a JWT."""

import secrets

from fastapi import APIRouter, HTTPException, status

from ..auth import create_access_token
from ..config import settings
from ..schemas import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest) -> TokenResponse:
    # compare_digest keeps the comparison constant-time.
    if not secrets.compare_digest(body.password, settings.admin_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password"
        )
    return TokenResponse(access_token=create_access_token())
