#!/usr/bin/env bash
# Min Side on your laptop, for clicking around in a real browser: the full-stack e2e services
# (MySQL with the generated dev data and the seeded e2e donor, the mock OIDC issuer, the API) plus
# `next dev` for apps/web pointed at them, with hot reload. See docs/minside-ssr-plan.md
# ("Local review by the user before committing") and docs/e2e.md.
#
#   pnpm minside:local           start the stack (if not up) and run `next dev` in the foreground;
#                                Ctrl-C stops the web server and leaves the stack running
#   pnpm minside:local dk        the same for the Danish site: its Sanity content, and a local stub
#                                of its REST backend (scripts/e2e/dk-backend-stub.mjs) instead of
#                                our API. One site at a time (next dev locks apps/web/.next/dev).
#   pnpm minside:local reset     re-seed the e2e donor (undo changes made while clicking around)
#   pnpm minside:local down      stop the web server and delete the stack
#
#   E2E_SKIP_STACK_BUILD=1       use the effekt-backend-dev:local image without rebuilding it
#
# Same services, project name and ports as `pnpm e2e:fullstack` (web 3100, API 5150, OIDC 8191,
# MySQL 3317), so the two can't run at the same time; Cypress can run against this one
# (cypress open --config-file cypress-fullstack.config.ts).
set -euo pipefail

cd "$(dirname "$0")/.."
if [ "${1:-}" = "dk" ]; then export MINSIDE_SITE=dk; fi
source scripts/e2e/web-env.sh

compose() { docker compose -f compose.dev.yml -f compose.e2e.yml "$@"; }
DB_URL="mysql://root:effekt-local@127.0.0.1:${E2E_DB_PORT}/EffektDonasjonDB_Local"

web_pids() { lsof -nP -tiTCP:"$E2E_WEB_PORT" -sTCP:LISTEN 2>/dev/null || true; }

case "${1:-up}" in
  down)
    pids=$(web_pids)
    if [ -n "$pids" ]; then kill $pids 2>/dev/null && echo "Stopped the web server on :$E2E_WEB_PORT"; fi
    if pkill -f scripts/e2e/dk-backend-stub.mjs 2>/dev/null; then echo "Stopped the Danish backend stub"; fi
    compose down -v --remove-orphans
    exit 0
    ;;
  reset)
    DB_URL="$DB_URL" node apps/api/prisma/e2e/seed.mjs
    echo "Re-seeded the e2e donor (900001)."
    exit 0
    ;;
  up | dk) ;;
  *)
    echo "Usage: pnpm minside:local [up|dk|reset|down]" >&2
    exit 2
    ;;
esac

if [ -n "$(web_pids)" ]; then
  echo "Port $E2E_WEB_PORT is in use (another \`next\` or \`pnpm e2e:fullstack\` run?)." >&2
  echo "Stop it first, or: pnpm minside:local down" >&2
  exit 1
fi

if [ "$(compose ps -q api 2>/dev/null)" != "" ] && compose ps api --format '{{.Health}}' | grep -q healthy; then
  echo "==> Stack already running"
else
  echo "==> Starting the stack (db, migrate + seed, mock OIDC, API); ~20 s warm, ~90 s on a cold image build"
  if [ "${E2E_SKIP_STACK_BUILD:-0}" != "1" ]; then
    compose build migrate
  fi
  compose up -d --wait
fi

if [ "${MINSIDE_SITE:-no}" = "dk" ]; then
  if ! lsof -nP -tiTCP:"$E2E_DK_API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    node scripts/e2e/dk-backend-stub.mjs >/dev/null &
    STUB_PID=$!
    trap 'kill "$STUB_PID" 2>/dev/null || true' EXIT
  fi
  SITE="DK"
  BACKEND="the Danish REST stub on http://localhost:${E2E_DK_API_PORT} (one synthetic donor)"
else
  SITE="NO"
  BACKEND="our API on http://localhost:${E2E_API_PORT}, MySQL ${DB_URL}"
fi

cat <<BANNER

  Min Side (${SITE}):  http://localhost:${E2E_WEB_PORT}/min-side/
  Backend:        ${BACKEND}

  Log in on the test login page: pick a test donor (or enter any claims by hand).
  Reset the e2e donor's data:  pnpm minside:local reset
  Stop:  Ctrl-C stops the web server (the stack keeps running); pnpm minside:local down stops all

BANNER

echo "==> next dev on :${E2E_WEB_PORT} (hot reload)"
pnpm --filter main-site exec next dev -p "$E2E_WEB_PORT"
