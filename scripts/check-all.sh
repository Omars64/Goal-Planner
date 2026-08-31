#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$project_dir"
npm run lint
npm run typecheck
npm test

cd "$project_dir/backend"
.venv/bin/ruff check app tests
.venv/bin/ruff format --check app tests
.venv/bin/pytest --cov=app --cov-report=term-missing --cov-fail-under=85

