#!/usr/bin/env bash
# Creates the read-only Google Cloud identity the Deploy workflow (.github/workflows/deploy.yml)
# uses to show BackendDeploy's Cloud Build steps as separate nodes (docs/ci.md).
#
#   scripts/ci/gcp-deploy-observer.sh            dry run: shows the current state, prints every command
#   scripts/ci/gcp-deploy-observer.sh --apply    creates what is missing
#
# Creates only new resources in project hidden-display-243419 (production):
#   - service account effekt-deploy-observer, with
#       roles/cloudbuild.builds.viewer on the project (builds and their step status; Cloud Build
#         has no per-trigger IAM), and
#       roles/logging.viewAccessor on one log view only, `cloudbuild-deploy-observer` on the
#         _Default bucket, which shows Cloud Build's logs (resource.type="build") and nothing else.
#         Used to read the deploy guard's "skipping" line. Narrower than roles/logging.viewer, which
#         would read every log in the project, the API's request logs included.
#   - workload identity pool github-effekt-deploy with one OIDC provider for GitHub Actions. Its
#     attribute condition accepts only tokens from this repository (by numeric id), from
#     refs/heads/main, from a push, and from the workflow file .github/workflows/deploy.yml on main
#     (job_workflow_ref). A pull request can't use it, nor can another workflow.
#   - roles/iam.workloadIdentityUser on the service account for that pool's principal set.
#   - GitHub repository variables DEPLOY_OBSERVER_WIF_PROVIDER and DEPLOY_OBSERVER_SA. Until they
#     exist the Deploy workflow shows BackendDeploy as one node (the GitHub check).
# Enables the IAM Credentials and STS APIs if they are off. Changes or deletes nothing else.
# Idempotent: re-running skips what exists.
#
# The identity can read build metadata (steps, substitutions, timing) and Cloud Build logs. It
# can't start, cancel or change builds, read secrets, or touch Cloud Run, Cloud SQL or storage.
#
# Requires gcloud (project owner or equivalent), gh (repository admin) and jq.
set -euo pipefail

PROJECT=hidden-display-243419
REPO=stiftelsen-effekt/effekt-platform
WORKFLOW=.github/workflows/deploy.yml
BRANCH_REF=refs/heads/main
SA_ID=effekt-deploy-observer
SA="${SA_ID}@${PROJECT}.iam.gserviceaccount.com"
POOL=github-effekt-deploy
PROVIDER=effekt-platform-deploy
VIEW=cloudbuild-deploy-observer

APPLY=false
case "${1:-}" in
  --apply) APPLY=true ;;
  "" | --dry-run) ;;
  -h | --help)
    sed -n '2,30p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown argument: $1 (use --apply, or nothing for a dry run)" >&2
    exit 2
    ;;
esac

command -v gcloud >/dev/null || { echo "gcloud is required" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

P=(--project "$PROJECT")
say() { printf '%s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }
run() {
  local arg shown=""
  for arg in "$@"; do
    # Single quotes, or double quotes for the arguments that contain one (the condition)
    if [[ "$arg" =~ ^[A-Za-z0-9_./:@%+=,-]+$ ]]; then
      shown+="$arg "
    elif [[ "$arg" != *"'"* ]]; then
      shown+="'$arg' "
    else
      shown+="\"$arg\" "
    fi
  done
  say "+ ${shown% }"
  if $APPLY; then "$@"; fi
}
# IAM changes right after creating a service account can fail until it has propagated
run_retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if run "$@"; then return 0; fi
    $APPLY || return 0
    say "  (attempt $attempt failed, retrying in 10s)"
    sleep 10
  done
  return 1
}

say "Project: $PROJECT, repository: $REPO"
say "Mode: $($APPLY && echo APPLY || echo 'dry run (pass --apply to change anything)')"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
REPO_ID=$(gh api "repos/$REPO" --jq .id)
JOB_WORKFLOW_REF="${REPO}/${WORKFLOW}@${BRANCH_REF}"
CONDITION="assertion.repository_id == '${REPO_ID}' && assertion.ref == '${BRANCH_REF}' && assertion.event_name == 'push' && assertion.job_workflow_ref == '${JOB_WORKFLOW_REF}'"
PROVIDER_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
PRINCIPAL_SET="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository_id/${REPO_ID}"
VIEW_NAME="projects/${PROJECT}/locations/global/buckets/_Default/views/${VIEW}"
say "Project number: $PROJECT_NUMBER, repository id: $REPO_ID"

section "APIs"
for api in iamcredentials.googleapis.com sts.googleapis.com; do
  if gcloud services list --enabled "${P[@]}" --filter="config.name=$api" --format='value(config.name)' | grep -q .; then
    say "$api: enabled"
  else
    run gcloud services enable "$api" "${P[@]}"
  fi
done

section "Service account $SA"
if gcloud iam service-accounts describe "$SA" "${P[@]}" >/dev/null 2>&1; then
  say "exists"
else
  run gcloud iam service-accounts create "$SA_ID" "${P[@]}" \
    --display-name "Deploy observer (GitHub Actions, read-only)" \
    --description "Read-only: Cloud Build status and logs for the Deploy workflow of $REPO (scripts/ci/gcp-deploy-observer.sh)"
fi

section "Cloud Build Viewer"
has_role() { # has_role ROLE
  gcloud projects get-iam-policy "$PROJECT" --format=json |
    jq -e --arg r "$1" --arg m "serviceAccount:$SA" \
      '.bindings[] | select(.role == $r and (.condition == null)) | .members | index($m)' >/dev/null
}
if has_role roles/cloudbuild.builds.viewer; then
  say "roles/cloudbuild.builds.viewer: granted"
else
  run_retry gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" \
    --role roles/cloudbuild.builds.viewer --condition None --quiet
fi

section "Log view $VIEW (Cloud Build logs only)"
if gcloud logging views describe "$VIEW" --bucket _Default --location global "${P[@]}" >/dev/null 2>&1; then
  say "exists: $(gcloud logging views describe "$VIEW" --bucket _Default --location global "${P[@]}" --format='value(filter)')"
else
  run gcloud logging views create "$VIEW" --bucket _Default --location global "${P[@]}" \
    --description "Cloud Build logs, for the read-only observer of the Deploy workflow" \
    --log-filter 'resource.type="build"'
fi
if gcloud projects get-iam-policy "$PROJECT" --format=json |
  jq -e --arg m "serviceAccount:$SA" '.bindings[] | select(.role == "roles/logging.viewAccessor") | .members | index($m)' >/dev/null; then
  say "roles/logging.viewAccessor (on the view): granted"
else
  run_retry gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA" \
    --role roles/logging.viewAccessor --quiet \
    --condition "expression=resource.name == \"${VIEW_NAME}\",title=cloudbuild-deploy-observer view only"
fi

section "Workload identity pool $POOL / provider $PROVIDER"
if gcloud iam workload-identity-pools describe "$POOL" --location global "${P[@]}" >/dev/null 2>&1; then
  say "pool exists"
else
  run gcloud iam workload-identity-pools create "$POOL" --location global "${P[@]}" \
    --display-name "GitHub Actions: deploy observer" \
    --description "GitHub Actions of $REPO, Deploy workflow on main only (scripts/ci/gcp-deploy-observer.sh)"
fi
if gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" \
  --location global "${P[@]}" >/dev/null 2>&1; then
  current=$(gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool "$POOL" \
    --location global "${P[@]}" --format='value(attributeCondition)')
  say "provider exists, condition: $current"
  [[ "$current" == "$CONDITION" ]] || say "  differs from the expected condition: $CONDITION (not changed)"
else
  run gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --location global \
    --workload-identity-pool "$POOL" "${P[@]}" \
    --display-name "effekt-platform Deploy workflow" \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.ref=assertion.ref,attribute.workflow_ref=assertion.job_workflow_ref,attribute.event_name=assertion.event_name" \
    --attribute-condition "$CONDITION"
fi

section "Who may act as $SA"
if gcloud iam service-accounts get-iam-policy "$SA" "${P[@]}" --format=json 2>/dev/null |
  jq -e --arg m "$PRINCIPAL_SET" '.bindings[]? | select(.role == "roles/iam.workloadIdentityUser") | .members | index($m)' >/dev/null; then
  say "roles/iam.workloadIdentityUser for $PRINCIPAL_SET: granted"
else
  run_retry gcloud iam service-accounts add-iam-policy-binding "$SA" "${P[@]}" \
    --role roles/iam.workloadIdentityUser --member "$PRINCIPAL_SET"
fi

section "GitHub variables (used by $WORKFLOW)"
for pair in "DEPLOY_OBSERVER_WIF_PROVIDER=$PROVIDER_NAME" "DEPLOY_OBSERVER_SA=$SA"; do
  name=${pair%%=*}
  value=${pair#*=}
  current=$(gh variable get "$name" --repo "$REPO" 2>/dev/null || true)
  if [[ "$current" == "$value" ]]; then
    say "$name: set"
  else
    run gh variable set "$name" --repo "$REPO" --body "$value"
  fi
done

section "Done"
say "Workflow values: workload_identity_provider=$PROVIDER_NAME service_account=$SA"
say "Attribute condition: $CONDITION"
$APPLY || say "Dry run: nothing changed."
cat <<EOF

To remove it again:
  gh variable delete DEPLOY_OBSERVER_WIF_PROVIDER --repo $REPO
  gh variable delete DEPLOY_OBSERVER_SA --repo $REPO
  gcloud iam workload-identity-pools delete $POOL --location global --project $PROJECT
  gcloud projects remove-iam-policy-binding $PROJECT --member serviceAccount:$SA --role roles/cloudbuild.builds.viewer --condition None
  gcloud projects remove-iam-policy-binding $PROJECT --member serviceAccount:$SA --role roles/logging.viewAccessor --all
  gcloud logging views delete $VIEW --bucket _Default --location global --project $PROJECT
  gcloud iam service-accounts delete $SA --project $PROJECT
EOF
