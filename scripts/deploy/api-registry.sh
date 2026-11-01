#!/usr/bin/env bash
# Creates the Artifact Registry repository the API image is pushed to (cloud.deploy.yaml):
# europe-north1-docker.pkg.dev/hidden-display-243419/effekt, in the region of the Cloud Run
# services, the migrate jobs and Cloud SQL. Idempotent; prints what it would do unless --apply.
#
#   bash scripts/deploy/api-registry.sh            # dry run: show the current state and the plan
#   bash scripts/deploy/api-registry.sh --apply    # create / update
#
# - Repository `effekt` (Docker, europe-north1).
# - roles/artifactregistry.writer for the BackendDeploy build service account (sa-build-backend).
#   Cloud Run (services and jobs) pulls with the project's Cloud Run service agent, which reads
#   every repository in its own project, so no reader grant is needed.
# - Cleanup policies as on gcr.io (docs/deploy.md): keep :buildcache and :latest, keep the 30
#   most recent versions, delete untagged versions after 7 days and any version after 90 days.
#   Applied for real (not dry run): gcloud can only turn dry run on, so this PATCHes it off.
set -euo pipefail
P=hidden-display-243419
LOC=europe-north1
REPO=effekt
BUILD_SA=sa-build-backend@$P.iam.gserviceaccount.com
apply=false
[ "${1:-}" = "--apply" ] && apply=true

run() {
  echo "+ $*"
  if $apply; then "$@"; fi
}

policy=$(mktemp)
trap 'rm -f "$policy"' EXIT
cat >"$policy" <<'JSON'
[
  {"name": "keep-recent", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 30}},
  {"name": "keep-named-tags", "action": {"type": "Keep"}, "condition": {"tagState": "TAGGED", "tagPrefixes": ["buildcache", "latest"]}},
  {"name": "delete-untagged", "action": {"type": "Delete"}, "condition": {"tagState": "UNTAGGED", "olderThan": "7d"}},
  {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"tagState": "ANY", "olderThan": "90d"}}
]
JSON

if gcloud artifacts repositories describe "$REPO" --location "$LOC" --project "$P" --format=none 2>/dev/null; then
  echo "== $LOC/$REPO exists"
else
  echo "== $LOC/$REPO missing"
  run gcloud artifacts repositories create "$REPO" --location "$LOC" --project "$P" \
    --repository-format docker --description "API image (cloud.deploy.yaml, docs/deploy.md)"
fi

run gcloud artifacts repositories add-iam-policy-binding "$REPO" --location "$LOC" --project "$P" \
  --member "serviceAccount:$BUILD_SA" --role roles/artifactregistry.writer --format=none

run gcloud artifacts repositories set-cleanup-policies "$REPO" --location "$LOC" --project "$P" \
  --policy "$policy" --format=none
echo "+ PATCH cleanupPolicyDryRun=false"
if $apply; then
  curl -sf -X PATCH -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" -d '{"cleanupPolicyDryRun": false}' \
    "https://artifactregistry.googleapis.com/v1/projects/$P/locations/$LOC/repositories/$REPO?updateMask=cleanup_policy_dry_run" \
    >/dev/null
  gcloud artifacts repositories describe "$REPO" --location "$LOC" --project "$P" \
    --format='value(cleanupPolicyDryRun)' | sed 's/^/cleanup dry run now: /'
else
  echo "Dry run: nothing changed. Re-run with --apply."
fi
