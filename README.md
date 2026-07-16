# Parlo

**Ask anything. Just talk.**

Parlo is a conversational data-collection platform. Instead of handing people a
form, you share a link — and an AI interviews them, one question at a time, in a
natural chat. You get structured, validated answers plus an insights dashboard
with charts and AI-written takeaways.

Built by Patrick Saade.

## How it works

1. **Build** — create a conversation in the dashboard: a title, a description,
   and any number of questions (free text, single/multiple choice, 1–5 rating,
   number, email).
2. **Share** — every conversation gets a short public link (`/f/<slug>`).
3. **Chat** — respondents answer by talking to the AI. The model asks one
   question at a time and extracts a normalized value from each reply; the
   **backend validates every value** against the question type before anything
   is stored. The model never writes to the database directly.
4. **Learn** — the insights page shows respondent counts, completion rate,
   per-question charts, all text answers, a CSV export, and an on-demand AI
   summary (3–6 bullets + overall sentiment).

## Architecture

```
                        ┌─────────────────────────────┐
                        │   Browser                   │
                        │   React 18 + Vite + TS      │
                        │   Tailwind · recharts       │
                        │   :3200                     │
                        └──────────────┬──────────────┘
                                       │ REST (JSON)
                                       ▼
┌───────────────┐       ┌─────────────────────────────┐       ┌───────────────┐
│  OpenAI API   │◄──────┤   FastAPI backend           ├──────►│  PostgreSQL   │
│  gpt-4o-mini  │  JSON │   SQLAlchemy · PyJWT        │  SQL  │  16           │
│               │  mode │   :8200                     │       │  :5433 (local)│
└───────────────┘       └─────────────────────────────┘       └───────────────┘

  Chat loop, per turn:
    respondent message ──► LLM returns strict JSON
      {reply, question_id, answer, done}
    ──► server validates `answer` against the question type
        (choice ∈ options · rating 1–5 · number · email regex)
    ──► valid: stored as an Answer · invalid: deterministic re-ask
```

**Data model:** `Form` (a conversation) → `Question`s (ordered, typed) →
`Session` (one respondent's run, with the full chat transcript) → `Answer`
(one validated value per question per session).

**Auth:** single creator. `POST /api/auth/login` exchanges `ADMIN_PASSWORD`
for a JWT; all `/api/admin/*` routes require it. Respondent routes
(`GET /api/forms/{slug}`, `POST /api/chat/{slug}`) are public and never expose
collected answers.

## Running it

```bash
cp .env.example .env      # fill in OPENAI_API_KEY, ADMIN_PASSWORD, SECRET_KEY
docker compose up --build
```

| Service   | URL                        |
| --------- | -------------------------- |
| Dashboard | http://localhost:3200      |
| API docs  | http://localhost:8200/docs |
| Postgres  | 127.0.0.1:5433             |

### Without Docker

Backend (needs a Postgres reachable via `DATABASE_URL`):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8200
```

Frontend:

```bash
cd frontend
npm install
npm run dev        # http://localhost:3200
```

## API overview

| Method | Route                                | Auth | Purpose                                  |
| ------ | ------------------------------------ | ---- | ---------------------------------------- |
| POST   | `/api/auth/login`                    | –    | password → JWT                            |
| GET    | `/api/admin/forms`                   | JWT  | list conversations + headline stats       |
| POST   | `/api/admin/forms`                   | JWT  | create a conversation                     |
| PATCH  | `/api/admin/forms/{id}`              | JWT  | rename / describe / open / close          |
| DELETE | `/api/admin/forms/{id}`              | JWT  | delete (cascades)                         |
| POST   | `/api/admin/forms/{id}/questions`    | JWT  | add a question                            |
| PATCH  | `/api/admin/questions/{id}`          | JWT  | edit a question                           |
| DELETE | `/api/admin/questions/{id}`          | JWT  | remove a question                         |
| PUT    | `/api/admin/forms/{id}/questions/reorder` | JWT | rewrite question order              |
| GET    | `/api/admin/forms/{id}/insights`     | JWT  | aggregates + 14-day activity              |
| GET    | `/api/admin/forms/{id}/export.csv`   | JWT  | one row per session, one column per question |
| POST   | `/api/admin/forms/{id}/summarize`    | JWT  | AI bullets + sentiment                    |
| GET    | `/api/forms/{slug}`                  | –    | public intro (title, description, count)  |
| POST   | `/api/chat/{slug}`                   | –    | one chat turn (creates a session on first call) |

## Environment variables

| Variable         | What it is                                        |
| ---------------- | ------------------------------------------------- |
| `OPENAI_API_KEY` | OpenAI key (chat + insights, model `gpt-4o-mini`) |
| `ADMIN_PASSWORD` | creator login password                            |
| `SECRET_KEY`     | JWT signing secret                                |
| `VITE_API_BASE`  | API base URL baked into the frontend build        |
| `FRONTEND_URL`   | allowed CORS origin                               |
| `DATABASE_URL`   | Postgres DSN (set automatically in Docker)        |

## Notes

- Tables are created on boot; move to Alembic migrations once the schema settles.
- The chat has a hard cap on transcript length as a runaway guard.
- Choice matching is case-insensitive; a corrected answer replaces the earlier
  one within the same session.
