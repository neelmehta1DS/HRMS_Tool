# DigiSync (HRMS + Slack LeaveBot) — Deployment Readiness

## Original problem statement
Deploy an existing GitHub repo (backend / frontend / slack_myleave) to Emergent.
Database is external PostgreSQL via Supabase. Google OAuth restricted to
`@1digitalstack.ai`.

## Architecture
- **Backend** (`/app/backend`): FastAPI + SQLAlchemy on Postgres (Supabase),
  Google OAuth (Calendar + Drive scopes for catch-ups), JWT cookie auth,
  APScheduler cron jobs (daily reset, morning digest, annual reset).
  Runs via supervisor as `backend` on `0.0.0.0:8001`, entry point `server:app`.
- **Frontend** (`/app/frontend`): React 19 + Vite 8. Runs via supervisor as
  `frontend` on port `3000` (`yarn start` = `vite --host 0.0.0.0 --port 3000`).
  Uses `REACT_APP_BACKEND_URL` (exposed via Vite `envPrefix`).
- **Slack bot** (`/app/slack_myleave`): Node.js Socket-Mode bot for approve/reject
  actions. Runs via supervisor as `slack_bot`
  (config at `/etc/supervisor/conf.d/slack_bot.conf`). Talks to backend at
  `http://localhost:8001` using `INTERNAL_API_KEY`.

## Deployment-related changes (2026-01-17)
1. **`/api` prefix** on every backend router (auth, users, leaves, catchups,
   bot, dashboard, admin, health) so the Emergent ingress routes them to
   backend pod.
2. Created **`/app/backend/server.py`** re-exporting `main.app` (supervisor
   expects `server:app`).
3. Wrote **`/app/backend/requirements.txt`** from a clean pip install (motor /
   pymongo removed — app is Postgres-only).
4. Backend `.env` set to production values: `DEBUG=False`,
   `SLACK_DEMO_MODE=False`, `APP_BASE_URL` / `FRONTEND_URL` /
   `ALLOWED_ORIGINS` point at the preview URL.
5. `pydantic-settings` now uses `extra="ignore"` so future stray env vars don't
   crash the app.
6. JWT cookie is now `secure=True` + `samesite=none` when `DEBUG=False`
   (required for cross-site auth in production).
7. **Google OAuth callback** moved to `/api/auth/oauth2callback`.
   Domain restriction `@1digitalstack.ai` retained.
8. **CORS**: `allow_origins` still honours `ALLOWED_ORIGINS`, plus
   `allow_origin_regex` matches any `*.preview.emergentagent.com` /
   `*.emergent.host` origin so promotion from preview → prod needs no code
   change. (`allow_credentials=True` forbids `*`.)
9. **Frontend**:
   - Vite `envPrefix: ['VITE_', 'REACT_APP_']` — accepts Emergent's
     `REACT_APP_BACKEND_URL`.
   - Vite `server`/`preview` bound to `0.0.0.0:3000`, `allowedHosts: true`.
   - `package.json` `start` script added.
   - `src/lib/api.js` derives `API_URL = ${REACT_APP_BACKEND_URL}/api`.
10. **Slack bot**: `api.js` now hits `/api/bot/*`, `.env` set to production
    (`DEMO_MODE=false`), added `/etc/supervisor/conf.d/slack_bot.conf`.

## What's implemented (verified working)
- `/api/health` returns `{"status":"healthy"}` externally.
- `/api/auth/login` 307-redirects to Google.
- `/api/auth/me` returns 401 without cookie (correct).
- `/api/bot/user/<slack-id>` returns real user data with `x-internal-key`.
- Frontend loads at the preview URL; Google login link resolves to
  `${REACT_APP_BACKEND_URL}/api/auth/login`.
- Slack bot connects to Slack via Socket Mode (`⚡ LeaveBot running`).
- Supabase Postgres schema is created + seeded on startup.

## Manual steps required BEFORE users can log in
1. In **Google Cloud Console** for client ID
   `607776626848-gjv0keqmddd6c93b42nd2rhc3lib2jdi.apps.googleusercontent.com`,
   add authorised redirect URI:
   `https://087f819d-b551-4c23-999f-87ef66df2e90.preview.emergentagent.com/api/auth/oauth2callback`
   (and add the final `<name>.emergent.host` URL after deployment).
2. When promoting to prod on `.emergent.host`, update these three values:
   - `backend/.env` → `APP_BASE_URL`, `FRONTEND_URL`, `ALLOWED_ORIGINS`
   - `frontend/.env` → `REACT_APP_BACKEND_URL`
   Nothing else needs to change (CORS regex + JWT cookie flags already handle prod).

## Backlog / P1
- Move committed Google OAuth secret, Supabase password, Slack tokens, and
  `INTERNAL_API_KEY` out of `.env` files and into Emergent's managed secrets
  once available. They are currently plaintext in `/app/*/{.env}`.
- Consider gating public `/api/leaves/holidays`, `/api/leaves/limits`,
  `/api/leaves/rules` behind auth if leave policy is considered confidential.
- Remove the SQLite migration branch in `main._migrate()` once nobody runs the
  app on SQLite locally.
