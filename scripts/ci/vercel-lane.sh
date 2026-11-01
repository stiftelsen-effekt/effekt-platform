#!/usr/bin/env bash
# The "web · <CC> · await Vercel …" jobs (docs/ci.md): waits for the project's deployment of the
# commit (await-vercel.sh) and decides whether the lane's Cypress job has anything to test.
# Writes url and skip (empty, or why there is nothing to test) to $GITHUB_OUTPUT.
#
# Env: as await-vercel.sh, plus SKIP (a reason from `changes`, e.g. no secrets on Dependabot PRs).
# On a push to main, previews don't exist: the Deploy workflow tests production.
set -euo pipefail
dir=$(dirname "$0")
export SHA="${SHA:?}"

if [[ "${GITHUB_EVENT_NAME:-}" == push && "$TARGET" == Preview ]]; then
  echo "skip=${SKIP:-production is tested by Deploy}" | tee -a "${GITHUB_OUTPUT:-/dev/null}"
  echo "main: the Deploy workflow tests the production deployment." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 0
fi
if [[ "${SKIP:-}" == *"fork PRs"* ]]; then
  # Vercel only builds a fork's pull request after a maintainer authorizes it
  echo "skip=$SKIP" | tee -a "${GITHUB_OUTPUT:-/dev/null}"
  exit 0
fi

out=$(mktemp)
GITHUB_OUTPUT="$out" bash "$dir/await-vercel.sh" || { cat "$out" >>"${GITHUB_OUTPUT:-/dev/null}"; exit 1; }
tee -a "${GITHUB_OUTPUT:-/dev/null}" <"$out"
built=$(sed -n 's/^built=//p' "$out")
reason=$(sed -n 's/^reason=//p' "$out")
if [[ "$built" != true ]]; then
  echo "skip=${reason:-no deployment}" | tee -a "${GITHUB_OUTPUT:-/dev/null}"
else
  echo "skip=${SKIP:-}" | tee -a "${GITHUB_OUTPUT:-/dev/null}"
fi
