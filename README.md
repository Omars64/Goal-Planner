# Goal Planner

Goal Planner is a full-stack daily and weekly planning workspace with a vivid neon visual direction. It combines a React 19 frontend built with Vite/Vinext and a FastAPI backend using PostgreSQL in production and SQLite for local development.

The included starter data is already tailored to an 8:00 AM–5:00 PM Sunday–Thursday engineering workday, including:

- Dhuhr from 11:50 AM–12:25 PM
- Lunch break from 1:00–2:00 PM
- Asr from 3:35–4:10 PM
- Short movement resets between focused work blocks
- A 10–15 minute after-lunch walk
- A 10,000-step goal, 30-minute walk habit, and movement reminders

The project is ready to push to GitHub, test in pull requests, package as containers, and publish on a Docker-compatible hosting service.

## Features

- **Overview:** daily score, tasks, timetable, habits, goals, events, and a 25/5 focus timer
- **Time table:** recurring multi-day blocks for work, prayer, breaks, planning, and movement
- **Schedule:** Sunday-first weekly calendar for one-off events
- **To-do:** priorities, statuses, categories, estimates, tags, dates, recurrence, search, and filters
- **Goals:** measurable targets, progress controls, deadlines, status, and completion tracking
- **Habits:** seven-day check-in grid, target days, streaks, and weekly consistency
- **Reminders:** browser/in-app alerts, recurrence, pause, snooze, and desktop notification permission
- **Insights:** 7/14/30-day charts, task completion, habit consistency, and review prompts
- **Settings:** work profile, step goal, week start, compact layout, JSON backup/import, and starter reset
- **Persistence:** normalized PostgreSQL or SQLite database managed by the Python API
- **Reliability:** error states, connectivity recovery, validation, destructive confirmations, and an error boundary
- **Responsive UI:** desktop, tablet, and mobile navigation and layouts
- **Keyboard navigation:** `Alt+1` through `Alt+9` opens the top-panel pages

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8 through Vinext, Shadcn/Radix primitives, Recharts |
| Backend | Python 3.12, FastAPI, Pydantic |
| Database | PostgreSQL in production; SQLite with WAL mode for local development |
| Tests | Node test runner, TypeScript, ESLint, Pytest, Ruff, coverage |
| Delivery | Docker Compose, GitHub Actions CI, GHCR container publishing |

## Quick start

### Requirements

- Node.js 22 or newer
- Python 3.12 or newer
- Git

### Windows PowerShell

```powershell
npm ci
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
```

### Linux or macOS

```bash
npm ci
chmod +x scripts/dev.sh scripts/check-all.sh
./scripts/dev.sh
```

Open the frontend at `http://localhost:3000`. FastAPI documentation is available at `http://localhost:8000/docs`.

### Start the services separately

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

On Windows, activate with `.venv\Scripts\Activate.ps1`.

Frontend:

```bash
npm ci
npm run dev
```

Copy `.env.example` to `.env.local` when the backend uses a different URL.

## Docker

Run both services and preserve SQLite data in a named volume:

```bash
docker compose up --build
```

Then open `http://localhost:3000`.

Stop without deleting planner data:

```bash
docker compose down
```

## Testing

Run the complete local regression suite:

```bash
./scripts/check-all.sh
```

Or run each side independently:

```bash
npm run lint
npm run typecheck
npm test

cd backend
.venv/bin/ruff check app tests
.venv/bin/ruff format --check app tests
.venv/bin/pytest --cov=app --cov-report=term-missing --cov-fail-under=85
```

## API and data

The frontend reads `NEXT_PUBLIC_API_URL`. Local development defaults to FastAPI at `http://localhost:8000/api`; Vercel uses the same-origin `/api` function automatically. The backend accepts CORS origins from `VICE_PLANNER_CORS_ORIGINS`. It uses managed Postgres when `DATABASE_URL` is present and falls back to SQLite at `VICE_PLANNER_DB_PATH` for local development.

Important endpoint groups:

- `/api/dashboard` and `/api/insights`
- `/api/routine-blocks`, `/api/events`, and `/api/tasks`
- `/api/goals`, `/api/habits`, and `/api/reminders`
- `/api/settings`, `/api/export`, `/api/import`, and `/api/system/reset`
- `/api/health`

The Settings page can export and restore a portable JSON backup. Database files and exported backups are intentionally ignored by Git.

## CI/CD

`.github/workflows/ci.yml` runs frontend linting, type checking, both Sites and Vercel production builds, backend linting, backend tests with an 85% coverage gate, and Docker image smoke builds. Vercel's GitHub integration deploys every branch and pull request as a preview and promotes successful pushes to `main` to production.

`.github/workflows/publish-images.yml` publishes versioned frontend and API images to GitHub Container Registry when a tag such as `v1.0.0` is pushed. Define the repository variable `NEXT_PUBLIC_API_URL` before publishing the web image for production.

Example release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Vercel deployment

The repository deploys as two Vercel projects connected to the same GitHub repository:

1. Import `backend/` as `goal-planner-api` and keep `main` as the production branch.
2. Add a Neon Postgres integration to the API project so it injects `DATABASE_URL`.
3. Import the repository root as `goal-planner` and set `NEXT_PUBLIC_API_URL` to the API project's `/api` URL.
4. Deploy both projects. Vercel automatically builds each project when `main` changes.

Schema creation and initial planner data are handled automatically on the first API request. Later pushes to GitHub create Vercel deployments without a local machine.

## Container deployment

Deploy the two containers to any Docker-compatible platform:

1. Publish the API with a persistent volume mounted at `/data`.
2. Set `VICE_PLANNER_DB_PATH=/data/vice_planner.db`.
3. Set `VICE_PLANNER_CORS_ORIGINS` to the public frontend origin.
4. Build the web image with `NEXT_PUBLIC_API_URL=https://your-api.example/api`.
5. Protect the deployment with platform authentication if it is accessible publicly.

The app has no built-in multi-user authentication because it is designed as a personal planner. Add authentication and per-user database ownership before offering it as a shared public service.

## Project layout

```text
app/                       React app entry and global theme
components/planner/        Planner shell, client, types, shared UI, and pages
backend/app/                FastAPI application and SQLite/Postgres access
backend/tests/              API regression suite
public/                     App icon and web manifest
scripts/                    Local startup and full-check scripts
.github/workflows/          CI and container publishing
Dockerfile                  Frontend production image
docker-compose.yml          Local full-stack container setup
```

## Branding note

The interface uses an original neon sunset and crime-game-inspired aesthetic. It is not affiliated with Rockstar Games or Take-Two Interactive, and it contains no extracted game artwork, logos, audio, or proprietary fonts.

## License

MIT. See [LICENSE](LICENSE).
