#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_dir="$project_dir/backend"

if [[ ! -x "$backend_dir/.venv/bin/python" ]]; then
  python3 -m venv "$backend_dir/.venv"
  "$backend_dir/.venv/bin/pip" install -r "$backend_dir/requirements.txt"
fi

(
  cd "$backend_dir"
  .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
api_pid=$!

cleanup() {
  kill "$api_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$project_dir"
npm run dev

