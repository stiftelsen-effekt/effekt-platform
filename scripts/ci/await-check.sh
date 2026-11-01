#!/usr/bin/env bash
# Waits for a check run on a commit, such as Cloud Build's "QualityAssurance (…)",
# "BackendDeploy (…)" or "AdminDeploy (…)", and mirrors its result (docs/ci.md).
#
# Cloud Build reports "neutral" with "Changed files did not match file filter" when the trigger's
# file filter left the commit out: that counts as "not triggered" (exit 0, ran=false).
#
# Writes to $GITHUB_OUTPUT: ran (true|false), conclusion, url (the check's details, e.g. the
# Cloud Build log), build_id (Cloud Build's build id, when the URL has one), started_at,
# completed_at. Exits 1 unless the check succeeded or wasn't triggered.
#
# With UNTIL=started it returns as soon as the check runs and names its Cloud Build build
# (ran=true, build_id, url, conclusion empty), or with the result if it finished already.
#
# Env: GH_TOKEN, REPO, SHA, CHECK (the check run's name), UNTIL (completed | started),
# TIMEOUT_MINUTES (default 45), APPEAR_MINUTES (how long to wait for the check to show up at all, default 10),
# INTERVAL (seconds, default 15).
set -euo pipefail

start=$(date +%s)
deadline=$((start + ${TIMEOUT_MINUTES:-45} * 60))
appear=$((start + ${APPEAR_MINUTES:-10} * 60))
interval="${INTERVAL:-15}"
name_q=$(jq -rn --arg n "$CHECK" '$n|@uri')

out() { echo "$1=$2" | tee -a "${GITHUB_OUTPUT:-/dev/null}"; }
summary() { echo "$*" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"; }

last=""
while :; do
  run=$(gh api "repos/$REPO/commits/$SHA/check-runs?check_name=$name_q&filter=latest" \
    --jq '.check_runs[0] // {}')
  status=$(jq -r '.status // "missing"' <<<"$run")
  conclusion=$(jq -r '.conclusion // ""' <<<"$run")
  url=$(jq -r '.details_url // ""' <<<"$run")
  if [[ "$status/$conclusion" != "$last" ]]; then
    echo "$(date -u +%H:%M:%S) $CHECK: $status${conclusion:+ ($conclusion)}${url:+ $url}"
    last="$status/$conclusion"
  fi

  if [[ "${UNTIL:-completed}" == started && "$status" == in_progress && "$url" == */builds/* ]]; then
    out ran true
    out conclusion ""
    out url "$url"
    out build_id "$(sed -nE 's#.*/builds/([0-9a-f-]+).*#\1#p' <<<"$url")"
    out started_at "$(jq -r '.started_at // ""' <<<"$run")"
    exit 0
  fi

  if [[ "$status" == completed ]]; then
    title=$(jq -r '.output.summary // ""' <<<"$run")
    build_id=$(sed -nE 's#.*/builds/([0-9a-f-]+).*#\1#p' <<<"$url")
    out conclusion "$conclusion"
    out url "$url"
    out build_id "$build_id"
    out started_at "$(jq -r '.started_at // ""' <<<"$run")"
    out completed_at "$(jq -r '.completed_at // ""' <<<"$run")"
    case "$conclusion" in
      success)
        out ran true
        summary "**$CHECK**: passed. ${title} ([log]($url))"
        exit 0
        ;;
      neutral | skipped)
        out ran false
        summary "**$CHECK**: not triggered (${title:-$conclusion})."
        exit 0
        ;;
      *)
        out ran true
        echo "::error::$CHECK: $conclusion. ${title} Log: $url"
        summary "**$CHECK**: $conclusion. ${title} ([log]($url))"
        exit 1
        ;;
    esac
  fi

  now=$(date +%s)
  if [[ "$status" == missing ]] && ((now > appear)); then
    echo "::error::$CHECK didn't report on $SHA within ${APPEAR_MINUTES:-10} minutes"
    exit 1
  fi
  if ((now > deadline)); then
    echo "::error::$CHECK didn't finish within ${TIMEOUT_MINUTES:-45} minutes (last: $status)"
    exit 1
  fi
  sleep "$interval"
done
