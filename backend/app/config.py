"""App configuration.

Everything secret or environment-specific comes from env vars (or a local
.env file) so nothing sensitive is ever hard-coded in the repo.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database connection string. Docker Compose overrides this to point at
    # the `db` service; the default works for a locally-installed Postgres.
    database_url: str = "postgresql://parlo:parlo@localhost:5433/parlo"

    # OpenAI powers the respondent chat and the AI insights summary.
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    # Single-admin auth: one password, exchanged for a JWT at /api/auth/login.
    admin_password: str = "change-me"
    secret_key: str = "dev-secret-change-me"
    token_expire_minutes: int = 60 * 24  # tokens last one day

    # Used for CORS so the browser app is allowed to call this API.
    frontend_url: str = "http://localhost:3200"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
