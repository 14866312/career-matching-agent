# Repository Guidelines

## Project Structure & Module Organization

- `backend/app/` contains the FastAPI routes, models, resume parsing, LLM adapter, data access, and deterministic matching logic. Generated career data lives in `backend/data/`.
- `frontend/src/` contains the React/TypeScript application. Put reusable logic in `lib/`, UI in `components/`, and Vitest files in `__tests__/`.
- `tests/` holds Python API and domain tests; `tests/browser/` contains Playwright end-to-end checks.
- `scripts/` builds data and runs live smoke checks. `samples/` is fictional test data, `docs/` contains contracts and ADRs, and `competition/` is read-only source material.

Before starting work, read `docs/工作日志.md` (current state, the user's standing decisions, GitHub workflow, open follow-ups). After significant work, add an entry at the top of its 日志 section and refresh 当前状态.

Read `CONTEXT.md` and relevant files in `docs/adr/` before changing domain terminology, matching rules, privacy boundaries, or report behavior.

## Build, Test, and Development Commands

Run commands from PowerShell on Windows:

- `./install.ps1` creates the Python environment, installs dependencies, and builds the frontend.
- `./start.ps1` serves the application at `http://127.0.0.1:8000`; use `-Port 8001` to change ports.
- `.venv/Scripts/python.exe -m pytest tests -q` runs Python tests.
- `npm.cmd --prefix frontend test` runs Vitest; `npm.cmd --prefix frontend run build` type-checks and builds.
- `.venv/Scripts/python.exe -m ruff check backend scripts tests` and `npm.cmd --prefix frontend run lint` run static checks.
- `.venv/Scripts/python.exe scripts/build_data.py` regenerates data from the competition spreadsheet; do not edit generated JSON directly.

## Coding Style & Naming Conventions

Use four spaces and `snake_case` for Python; Ruff targets Python 3.12 with a 100-character line length. TypeScript is strict and checked by ESLint. Follow existing single-quote and semicolon conventions, use `PascalCase` for React components, and `camelCase` for functions and variables. Keep matching calculations deterministic and separate from LLM calls.

## Testing Guidelines

Name Python tests `test_*.py` and frontend tests `*.test.ts`. Add focused regression tests beside the affected layer. For browser checks, start `tests/e2e_server.py`, then run `npm.cmd --prefix tests/browser test` in another terminal. Mocked E2E model output is not evidence of a successful live provider call.

## Commit & Pull Request Guidelines

Prefer the repository's Conventional Commit style: `feat(frontend): ...`, `fix(smoke): ...`, `docs(acceptance): ...`. Pull requests should explain the user-visible change, note domain or privacy effects, list validation commands, link the relevant `本地资料/scratch/<feature-slug>/` issue, and include screenshots for UI changes.

## Security & Agent Workflow

Copy `.env.example` to `.env`; never commit or echo credentials. Preserve session-only resume data and name isolation. Local specs and issues live under `本地资料/scratch/`; follow `docs/agents/issue-tracker.md`, `triage-labels.md`, and `domain.md` when managing them.
