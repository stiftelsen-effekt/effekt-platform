#!/usr/bin/env bash
# The last job of the CI and Deploy workflows (docs/ci.md): a table of every job in this run
# (lane, result, duration, link) and the links in $LINKS, written to $GITHUB_STEP_SUMMARY. Exits 1
# when a job this one needs didn't succeed.
#
# Env: GH_TOKEN, REPO, RUN_ID, RUN_ATTEMPT, RESULTS (toJSON(needs)), TITLE,
# LINKS (lines of "label|url"; empty URLs are left out), SELF (this job's name, left out of the
# table), ALLOW (optional: job ids whose "cancelled" counts as fine, e.g. superseded production
# e2e runs).
set -euo pipefail

summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
jobs=$(gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/attempts/$RUN_ATTEMPT/jobs?per_page=100" \
  --jq '.jobs[]' | jq -s .)

failed=$(jq -r --arg allow " ${ALLOW:-} " '[to_entries[]
  | select(.value.result != "success")
  | select(.value.result != "cancelled" or ($allow | contains(" " + .key + " ") | not))
  | "\(.key) (\(.value.result))"] | join(", ")' <<<"$RESULTS")

{
  if [[ -z "$failed" ]]; then
    echo "## $TITLE: all lanes passed"
  else
    echo "## $TITLE: not passed: $failed"
  fi
  echo
  echo "| Lane | Result | Duration |"
  echo "| --- | --- | --- |"
  jq -r --arg self "${SELF:-}" '
    def icon: {"success": "passed", "failure": "**failed**", "cancelled": "cancelled",
      "skipped": "skipped", "neutral": "neutral", "timed_out": "**timed out**"}[.] // (. // "running");
    def secs: if .started_at and .completed_at
      then ((.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601)) else null end;
    def dur: if . == null then "" elif . < 60 then "\(.)s" else "\(. / 60 | floor)m \(. % 60)s" end;
    sort_by(.started_at // "") | .[] | select(.name != $self)
    | "| [\(.name)](\(.html_url)) | \(.conclusion | icon) | \(secs | dur) |"' <<<"$jobs"
  links=$(grep -E '\|https?://' <<<"${LINKS:-}" || true)
  if [[ -n "$links" ]]; then
    echo
    echo "**Links:** $(awk -F'|' '{printf "%s[%s](%s)", (NR > 1 ? " · " : ""), $1, $2}' <<<"$links")"
  fi
} >>"$summary"

if [[ -n "$failed" ]]; then
  echo "::error::Not passed: $failed"
  exit 1
fi
