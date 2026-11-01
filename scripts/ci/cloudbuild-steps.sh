#!/usr/bin/env bash
# Waits for steps of a Cloud Build build and mirrors their result (the Deploy workflow's
# `api · …` jobs, docs/ci.md). Read-only: it needs an access token of the deploy observer
# (scripts/ci/gcp-deploy-observer.sh): Cloud Build Viewer and the Cloud Build log view only.
#
# Writes to $GITHUB_OUTPUT: status (the last step's status), and with CHECK_GUARD=1,
# guard_skipped (true | false | unknown): whether scripts/deploy/guard.sh skipped the rest of the
# build because a newer commit deploys. Exits 1 when a step didn't succeed.
#
# Env: TOKEN, GCP_PROJECT, BUILD_ID, STEPS (step ids, space-separated), CHECK_GUARD (optional),
# LOG_VIEW (the log view's resource name, for CHECK_GUARD), TIMEOUT_MINUTES (default 40),
# INTERVAL (seconds, default 10).
set -euo pipefail

deadline=$(($(date +%s) + ${TIMEOUT_MINUTES:-40} * 60))
read -r -a steps <<<"${STEPS:?}"
api="https://cloudbuild.googleapis.com/v1/projects/$GCP_PROJECT/builds/$BUILD_ID"
console="https://console.cloud.google.com/cloud-build/builds/$BUILD_ID?project=$GCP_PROJECT"

out() { echo "$1=$2" | tee -a "${GITHUB_OUTPUT:-/dev/null}"; }
summary() { echo "$*" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"; }
terminal() { [[ "$1" =~ ^(SUCCESS|FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED)$ ]]; }

last=""
while :; do
  build=$(curl -fsS -H "Authorization: Bearer $TOKEN" "$api")
  build_status=$(jq -r .status <<<"$build")
  line="build $build_status"
  done_all=true
  for step in "${steps[@]}"; do
    s=$(jq -r --arg id "$step" '[.steps[] | select(.id == $id)][0].status // "MISSING"' <<<"$build")
    line="$line, $step $s"
    terminal "$s" || done_all=false
  done
  if [[ "$line" != "$last" ]]; then
    echo "$(date -u +%H:%M:%S) $line"
    last="$line"
  fi
  # A finished build leaves the steps after a failure as QUEUED: they never ran
  if [[ "$done_all" == true ]] || terminal "$build_status"; then break; fi
  if (($(date +%s) > deadline)); then
    echo "::error::Cloud Build steps didn't finish within ${TIMEOUT_MINUTES:-40} minutes: $line"
    exit 1
  fi
  sleep "${INTERVAL:-10}"
done

failed=""
for step in "${steps[@]}"; do
  s=$(jq -r --arg id "$step" '[.steps[] | select(.id == $id)][0].status // "MISSING"' <<<"$build")
  timing=$(jq -r --arg id "$step" '.steps[] | select(.id == $id) | .timing // {}
    | if .startTime and .endTime then
        "\(((.endTime | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) - (.startTime | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601)))s"
      else "" end' <<<"$build")
  summary "- \`$step\`: $s${timing:+ in $timing} ([log]($console))"
  [[ "$s" == SUCCESS ]] || failed="$failed $step ($s)"
  out status "$s"
done

if [[ "${CHECK_GUARD:-}" == 1 ]]; then
  # guard.sh prints "deploy-guard: skipping the rest of this build: …" when a newer commit
  # deploys; every later step then exits 0 without doing anything.
  body=$(jq -n --arg view "$LOG_VIEW" --arg id "$BUILD_ID" '{
    resourceNames: [$view], pageSize: 1, orderBy: "timestamp desc",
    filter: "resource.type=\"build\" AND resource.labels.build_id=\"\($id)\" AND textPayload:\"deploy-guard: skipping\""}')
  if entries=$(curl -fsS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "$body" https://logging.googleapis.com/v2/entries:list); then
    message=$(jq -r '.entries[0].textPayload // empty' <<<"$entries")
    if [[ -n "$message" ]]; then
      out guard_skipped true
      echo "::notice::${message#*deploy-guard: }"
      summary "Skipped by the deploy guard: ${message#*deploy-guard: skipping the rest of this build: }"
    else
      out guard_skipped false
    fi
  else
    echo "::warning::Could not read the build's log (the log view grant?): the guard's decision is unknown"
    out guard_skipped unknown
  fi
fi

if [[ -n "$failed" ]]; then
  echo "::error::Cloud Build step(s) not successful:$failed. Log: $console"
  exit 1
fi
