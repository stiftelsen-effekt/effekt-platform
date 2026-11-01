#!/usr/bin/env bash
# Which lanes of the CI and Deploy workflows a change touches (docs/ci.md).
#
# Lists the changed files (a pull request's files, or the commits a push added) and writes one
# `<lane>=true|false` line per lane to $GITHUB_OUTPUT, plus a table to $GITHUB_STEP_SUMMARY.
# Anything unexpected (no event data, a list that may be truncated) counts as "changed".
#
# Env: GH_TOKEN, REPO, EVENT (pull_request | push), PR (pull_request), BEFORE and SHA (push),
# CHANGED_FILES (optional: a file with the list, for testing).
set -euo pipefail

files="${RUNNER_TEMP:-/tmp}/changed-files"
all=false
if [[ -n "${CHANGED_FILES:-}" ]]; then
  cp "$CHANGED_FILES" "$files"
elif [[ "${EVENT:-}" == pull_request ]]; then
  gh api --paginate "repos/$REPO/pulls/$PR/files" --jq '.[].filename' >"$files"
  # The files API lists at most 3000 files
  [[ $(wc -l <"$files") -ge 3000 ]] && all=true
elif [[ "${EVENT:-}" == push && -n "${BEFORE:-}" && ! "$BEFORE" =~ ^0+$ ]]; then
  compare=$(gh api "repos/$REPO/compare/$BEFORE...$SHA")
  echo "$compare" | jq -r '.files[]?.filename' >"$files"
  # The compare API lists at most 300 files
  [[ $(wc -l <"$files") -ge 300 ]] && all=true
else
  : >"$files"
  all=true
fi

# lane|description|patterns (bash `case` globs: `*` also matches `/`). Keep in sync with what
# each lane builds from; the admin's list is the AdminDeploy trigger's (cloudbuild.admin.yaml).
lanes=(
  "api|API (apps/api) and its image|apps/api/* packages/* package.json pnpm-lock.yaml pnpm-workspace.yaml cloud.deploy.yaml cloud.qa.yaml scripts/deploy/* .nvmrc"
  "admin|Admin (apps/admin)|apps/admin/* apps/api/src/* apps/api/prisma/schema.prisma apps/api/package.json apps/api/tsconfig*.json packages/* pnpm-lock.yaml pnpm-workspace.yaml cloudbuild.admin.yaml scripts/deploy/* .github/workflows/ci.yml scripts/ci/*"
  "functions|Cloud Functions (functions/*)|functions/* pnpm-lock.yaml pnpm-workspace.yaml .github/workflows/ci.yml scripts/ci/*"
  "web|Website (apps/web) and the tRPC contract it compiles in|apps/web/* apps/api/src/trpc/* packages/api/* packages/config/* apps/api/scripts/build-types.mjs apps/api/tsconfig.trpc.json pnpm-lock.yaml pnpm-workspace.yaml .nvmrc .github/workflows/ci.yml scripts/ci/*"
  "studio|Sanity Studio (apps/web/studio)|apps/web/studio/* pnpm-lock.yaml pnpm-workspace.yaml .nvmrc .github/workflows/ci.yml scripts/ci/*"
  "fullstack|Full-stack e2e (web, API, MySQL)|apps/web/* apps/api/* compose.dev.yml compose.e2e.yml compose.e2e-ci.yml .env.docker scripts/e2e-fullstack.sh scripts/e2e/* package.json pnpm-lock.yaml pnpm-workspace.yaml .github/workflows/ci.yml scripts/ci/*"
)

count=$(grep -c . "$files" || true)
{
  echo "### Changed paths"
  echo
  if [[ "$all" == true ]]; then
    echo "Could not list every changed file ($count listed): every lane runs."
  else
    echo "$count changed files."
  fi
  echo
  echo "| Lane | Runs | Why |"
  echo "| --- | --- | --- |"
} >>"${GITHUB_STEP_SUMMARY:-/dev/null}"

for entry in "${lanes[@]}"; do
  IFS='|' read -r lane description patterns <<<"$entry"
  read -r -a globs <<<"$patterns"
  hit=""
  if [[ "$all" != true ]]; then
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      for glob in "${globs[@]}"; do
        # shellcheck disable=SC2053 # the glob is meant to match as a pattern
        if [[ "$file" == $glob ]]; then
          hit="$file"
          break 2
        fi
      done
    done <"$files"
  fi
  if [[ "$all" == true || -n "$hit" ]]; then
    changed=true
    why="${hit:+changed: \`$hit\`}"
    why="${why:-every lane runs}"
  else
    changed=false
    why="no change to: $patterns"
  fi
  echo "$lane=$changed" | tee -a "${GITHUB_OUTPUT:-/dev/null}"
  echo "| $description | $([[ $changed == true ]] && echo yes || echo no) | $why |" >>"${GITHUB_STEP_SUMMARY:-/dev/null}"
done
