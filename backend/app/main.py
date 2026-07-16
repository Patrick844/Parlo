"""Parlo API entry point.

Wires everything together: creates tables on startup, opens CORS to the
frontend, and mounts the four routers under /api.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from .routers import auth, forms_admin, insights, public


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Simple create-on-boot; swap for Alembic migrations once the schema settles.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Parlo API",
    description="Conversational data collection — ask anything, just talk.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(forms_admin.router, prefix="/api")
app.include_router(insights.router, prefix="/api")
app.include_router(public.router, prefix="/api")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "app": "parlo"}
