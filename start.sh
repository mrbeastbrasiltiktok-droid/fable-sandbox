#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
PROJECT_DIR="$(pwd)"
GAME_DIR="${GAME_DIR:-gta_fable5.1}"
GAME_ROOT="$PROJECT_DIR/$GAME_DIR"
DIST_DIR="$GAME_ROOT/dist"
PORT="${PORT:-3000}"
META_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"

/usr/bin/time -p mkdir -p "$META_DIR"
cd "$GAME_ROOT"

if [[ ! -x node_modules/.bin/vite ]]; then
  if [[ -f package-lock.json ]]; then
    /usr/bin/time -p npm ci --no-audit --no-fund
  else
    /usr/bin/time -p npm install --no-audit --no-fund
  fi
fi

/usr/bin/time -p npm run build
/usr/bin/time -p test -f "$DIST_DIR/index.html"

/usr/bin/time -p printf '{"project":"%s","directory":"%s"}\n' "$PROJECT_DIR" "$DIST_DIR" > "$META_DIR/deployment-output.json"

exec /usr/bin/time -p python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DIST_DIR"
