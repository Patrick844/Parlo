"""App configuration.

Everything secret or environment-specific comes from env vars (or a local
.env file) so nothing sensitive is ever hard-coded in the repo.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database connection string (read from DATABASE_URL). Docker Compose points
    # this at the `db` service; the default works for a locally-installed
    # Postgres. A full managed URL with query params — e.g. a Neon connection
    # string ending in `?sslmode=require&channel_binding=require` — is passed
    # straight through to the driver unchanged (nothing here strips or rewrites
    # it), so external SSL/channel-binding options work as-is.
    database_url: str = "postgresql://parlo:parlo@localhost:5433/parlo"

    # OpenAI powers the respondent chat and the AI insights summary.
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Guest auth is email-only (no password), so ADMIN_PASSWORD is no longer
    # used — kept here only so an old .env with it set doesn't error. DEPRECATED.
    admin_password: str = "change-me"
    # Signs the guest JWTs (`sub` = user id). Same algo/expiry as before.
    secret_key: str = "dev-secret-change-me"
    token_expire_minutes: int = 60 * 24  # tokens last one day

    # Used for CORS so the browser app is allowed to call this API.
    frontend_url: str = "http://localhost:3200"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
