#!/usr/bin/env bash
# Waits for a Vercel project's deployment of a commit and reports it (docs/ci.md).
#
# Vercel reports each project as the commit status "Vercel – <project>": pending while it
# builds, then success ("Deployment has completed", or "Canceled by Ignored Build Step" when
# apps/web/vercel-ignore-build.sh found no website change), failure or error. For a completed
# build, the GitHub deployment in the environment "<Preview|Production> – <project>" has the
# deployment's URL.
#
# Writes to $GITHUB_OUTPUT: built (true|false), url (the deployment), inspect (Vercel's page for
# it), reason (why there is nothing to test, when built=false). Exits 1 when the deployment
# failed or didn't report in time.
#
# Env: GH_TOKEN, REPO, SHA, PROJECT (main-site | ge-effektivt | giv-effektivt),
# TARGET (Preview | Production), TIMEOUT_MINUTES (default 30), INTERVAL (seconds, default 15).
set -euo pipefail

context="Vercel – $PROJECT"
environment="$TARGET – $PROJECT"
deadline=$(($(date +%s) + ${TIMEOUT_MINUTES:-30} * 60))
interval="${INTERVAL:-15}"

out() { echo "$1=$2" | tee -a "${GITHUB_OUTPUT:-/dev/null}"; }
summary() { echo "$*" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"; }

last=""
while :; do
  # Newest first; one commit can have several (pending, then the result)
  status=$(gh api "repos/$REPO/commits/$SHA/statuses?per_page=100" \
    --jq "[.[] | select(.context == \"$context\")][0] // {}")
  state=$(jq -r '.state // "missing"' <<<"$status")
  description=$(jq -r '.description // ""' <<<"$status")
  inspect=$(jq -r '.target_url // ""' <<<"$status")
  if [[ "$state/$description" != "$last" ]]; then
    echo "$(date -u +%H:%M:%S) $context: $state${description:+ ($description)}"
    last="$state/$description"
  fi

  case "$state" in
    success)
      out inspect "$inspect"
      if [[ "$description" == *"Ignored Build Step"* ]]; then
        out built false
        out reason "no web change"
        summary "**$PROJECT**: no website change, Vercel skipped the build (Ignored Build Step)."
        exit 0
      fi
      id=$(gh api "repos/$REPO/deployments?sha=$SHA&environment=$(jq -rn --arg e "$environment" '$e|@uri')" \
        --jq '.[0].id // empty')
      url=""
      if [[ -n "$id" ]]; then
        url=$(gh api "repos/$REPO/deployments/$id/statuses" \
          --jq '[.[] | select(.state == "success")][0].environment_url // empty')
      fi
      if [[ -z "$url" ]]; then
        echo "::error::$context reports success, but there is no deployment in \"$environment\" with a URL"
        exit 1
      fi
      out built true
      out url "$url"
      summary "**$PROJECT**: deployed to $url ([Vercel]($inspect))."
      exit 0
      ;;
    failure | error)
      out built false
      out inspect "$inspect"
      echo "::error::Vercel deployment of $PROJECT: $state ($description). Logs: $inspect"
      summary "**$PROJECT**: Vercel deployment $state ($description), [logs]($inspect)."
      exit 1
      ;;
  esac

  if (($(date +%s) > deadline)); then
    echo "::error::$context didn't finish within ${TIMEOUT_MINUTES:-30} minutes (last: $state)"
    exit 1
  fi
  sleep "$interval"
done
