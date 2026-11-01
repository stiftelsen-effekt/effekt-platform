#!/usr/bin/env bash
# Phase 5 of docs/impact-api-migration.md: which backend answers impact.gieffektivt.no, and do the
# headers survive the load balancer? Read-only.
#
#   scripts/impact-compat/lb-check.sh [requests]    # default 40
#
# Sends the same request N times (unique cachebust, so the legacy Datastore cache can't mask it),
# counts answers from the legacy API (Django sets Content-Language) and from effektapi, and checks
# that every answer has CORS * and, from effektapi, Cache-Control public, max-age=3600. Then checks
# that the X-Impact-Backend: legacy pin still reaches the legacy API, and compares one answer of
# each backend byte for byte. bash 3.2 compatible.
set -euo pipefail

N="${1:-40}"
URL="https://impact.gieffektivt.no/api/evaluations?charity_abbreviation=AMF&donation_year=2024&donation_month=3&currency=GBP"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

legacy=0
new=0
bad=0
i=0
while [ "$i" -lt "$N" ]; do
  i=$((i + 1))
  h="$work/h$i"
  curl -sS -D "$h" -o "$work/b$i" -H "Origin: https://example.org" "$URL&cachebust=check$$-$i" || true
  if grep -qi '^content-language:' "$h"; then
    legacy=$((legacy + 1))
    cp "$work/b$i" "$work/legacy.json"
  else
    new=$((new + 1))
    cp "$work/b$i" "$work/new.json"
    if ! grep -qi '^cache-control: public, max-age=3600' "$h"; then
      echo "effektapi answer $i without Cache-Control public, max-age=3600"
      bad=$((bad + 1))
    fi
  fi
  if ! grep -qi '^access-control-allow-origin: \*' "$h"; then
    echo "answer $i without Access-Control-Allow-Origin: *"
    bad=$((bad + 1))
  fi
  if ! grep -q '^HTTP/[0-9.]* 200' "$h"; then
    echo "answer $i: $(head -1 "$h")"
    bad=$((bad + 1))
  fi
done
echo "$N requests: legacy $legacy, effektapi $new, header problems $bad"

pin="$work/pin"
curl -sS -D "$pin" -o /dev/null -H "X-Impact-Backend: legacy" "$URL&cachebust=pin$$"
if grep -qi '^content-language:' "$pin"; then
  echo "Pin header reaches the legacy API: ok"
else
  echo "Pin header did NOT reach the legacy API (the dual-run diff will report unreachable)"
fi

if [ -f "$work/legacy.json" ] && [ -f "$work/new.json" ]; then
  if cmp -s "$work/legacy.json" "$work/new.json"; then
    echo "Legacy and effektapi answers: identical"
  else
    echo "Legacy and effektapi answers DIFFER:"
    diff <(tr ',' '\n' <"$work/legacy.json") <(tr ',' '\n' <"$work/new.json") | head -20 || true
  fi
fi
