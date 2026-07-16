# Parlo — Deployment & CI/CD

How Parlo ships to production, and exactly what the GitHub Action does.

Live at **https://forms.patricksaade.dev** (EC2 + Docker + Caddy).

---

## Architecture

Parlo is three containers, defined in `docker-compose.yml`:

| Service | Port (host) | What it is |
|---|---|---|
| `db` | 127.0.0.1:5433 | PostgreSQL 16 (bound to localhost only) |
| `backend` | 8200 | FastAPI + SQLAlchemy — all routes under `/api/*` |
| `frontend` | 3200 | nginx serving the built React SPA |

In production it lives behind **Caddy** on a **single subdomain**. Because every
backend route is under `/api/*` and the frontend calls `${VITE_API_BASE}/api/...`,
Caddy can route by path — the browser and the API share one origin, so there is
**no CORS** to configure and only **one** DNS record / TLS cert:

```caddyfile
# /etc/caddy/Caddyfile  (on the EC2 box)
forms.patricksaade.dev {
    handle /api/* {
        reverse_proxy localhost:8200   # FastAPI
    }
    handle {
        reverse_proxy localhost:3200   # nginx SPA
    }
}
```

```
Browser ──▶ forms.patricksaade.dev (Caddy :443, auto Let's Encrypt)
              ├── /api/*  ──▶ localhost:8200  backend  ──▶ db:5432
              └── /*      ──▶ localhost:3200  frontend (nginx SPA)
```

---

## The GitHub Action — `.github/workflows/deploy.yml`

**Trigger:** every push to `main`, or manually from the repo's **Actions** tab
("Run workflow"). A `concurrency` group makes deploys queue instead of overlapping.

**What each step does:**

1. **Checkout** — pulls the repo onto the GitHub runner.
2. **Generate `.env` from secrets** — writes the runtime `.env` that
   `docker-compose` reads. Secrets never live in the repo; they're injected here:
   `OPENAI_API_KEY`, `ADMIN_PASSWORD`, `SECRET_KEY`, plus the two public URLs
   (`VITE_API_BASE` / `FRONTEND_URL`, both `https://forms.patricksaade.dev`).
   > `VITE_API_BASE` is **baked into the frontend bundle at build time** — that's
   > why it's set here and why a change requires a rebuild (which this action does).
3. **Configure SSH** — writes the deploy key (`EC2_SSH_KEY`) to `~/.ssh/deploy_key`.
4. **Bootstrap server** — idempotent: installs Docker (official script) and rsync
   if missing, and `systemctl enable --now docker`. Safe to run every time.
5. **Sync code** — `rsync -az --delete` the repo to `/home/ubuntu/parlo`, excluding
   `.git`, `node_modules`, `dist`, `__pycache__`, `*.pem`. `--delete` keeps the
   server tree identical to git (removed files disappear on the server too).
6. **Build & start** — over SSH: `docker compose up -d --build`, then
   `docker image prune -f` to reclaim disk, then `docker compose ps` for a status
   readout in the Action log.

**Net effect:** push to `main` → ~2–4 minutes later the live site is rebuilt and
restarted with the new code. No manual SSH needed.

---

## Required GitHub secrets

Set these in the repo → **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `EC2_HOST` | `13.61.103.66` |
| `EC2_SSH_KEY` | full contents of `survey-chatbot.pem` (the private key) |
| `OPENAI_API_KEY` | your OpenAI key (respects the $20/month cap) |
| `ADMIN_PASSWORD` | the creator-login password for Parlo's dashboard |
| `SECRET_KEY` | any long random string (JWT signing) |

---

## One-time server + DNS setup (before the first deploy works)

1. **Cloudflare DNS:** add an **A** record `forms` → `13.61.103.66`, **DNS only** (grey cloud).
2. **Caddy:** add the `forms.patricksaade.dev` block shown above to
   `/etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`. Caddy fetches the
   TLS cert automatically (needs the DNS record live + port 80 open).
3. **Ports:** nothing new to open in the security group — Caddy already owns 80/443
   and proxies to `localhost:8200`/`3200`, which stay internal.

After that, every push to `main` deploys automatically.

---

## Manual deploy (if you ever need it without the Action)

```bash
# from a local clone, with the real .env present locally:
rsync -az --delete --exclude .git --exclude node_modules --exclude dist \
  --exclude __pycache__ --exclude "*.pem" \
  -e "ssh -i ~/Downloads/survey-chatbot.pem" \
  ./ ubuntu@13.61.103.66:/home/ubuntu/parlo/
ssh -i ~/Downloads/survey-chatbot.pem ubuntu@13.61.103.66 \
  'cd ~/parlo && docker compose up -d --build'
```

---

## Local development

```bash
cp .env.example .env      # fill in OPENAI_API_KEY + a password
docker compose up --build
# frontend → http://localhost:3200   ·   API → http://localhost:8200/docs
```
