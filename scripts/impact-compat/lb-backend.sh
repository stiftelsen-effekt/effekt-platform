#!/usr/bin/env bash
# Phase 5 of docs/impact-api-migration.md, step 1 of the switch: a backend service for the
# impact.gieffektivt.no traffic that goes to effektapi.
#
#   scripts/impact-compat/lb-backend.sh            # dry run: prints what it would create
#   scripts/impact-compat/lb-backend.sh --apply    # creates it
#
# Creates a serverless NEG on the effektapi Cloud Run service and a backend service with the same
# settings as bs-effektapi (EXTERNAL_MANAGED, HTTP, 30 s timeout, logging every request, Cloud
# Armor policy effekt-api-armor). A backend of its own, rather than bs-effektapi, keeps the impact
# traffic apart in the LB metrics and logs (backend_service_name) and can be removed in phase 6
# without touching data.gieffektivt.no. Nothing routes to it until lb-weight.sh runs.
#
# Idempotent: existing resources are left alone. Rollback (only when no route rule uses it):
#   gcloud compute backend-services delete bs-effektapi-impact --global --project hidden-display-243419
#   gcloud compute network-endpoint-groups delete neg-effektapi-impact --region europe-north1 --project hidden-display-243419
#
# bash 3.2 compatible (macOS).
set -euo pipefail

PROJECT="hidden-display-243419"
REGION="europe-north1"
SERVICE="effektapi"
NEG="neg-effektapi-impact"
BACKEND="bs-effektapi-impact"
POLICY="effekt-api-armor"

APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h | --help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

run() {
  echo "+ $*"
  if [ "$APPLY" = 1 ]; then "$@"; fi
}

if gcloud compute network-endpoint-groups describe "$NEG" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  echo "NEG $NEG exists"
else
  run gcloud compute network-endpoint-groups create "$NEG" \
    --project "$PROJECT" --region "$REGION" \
    --network-endpoint-type serverless --cloud-run-service "$SERVICE"
fi

if gcloud compute backend-services describe "$BACKEND" --global --project "$PROJECT" >/dev/null 2>&1; then
  echo "Backend service $BACKEND exists"
else
  run gcloud compute backend-services create "$BACKEND" \
    --project "$PROJECT" --global \
    --load-balancing-scheme EXTERNAL_MANAGED --protocol HTTP --timeout 30s \
    --enable-logging --logging-sample-rate 1.0
fi
# Each step checks the live state, so a run that stopped halfway can simply be repeated
if [ "$APPLY" = 1 ] && gcloud compute backend-services describe "$BACKEND" --global --project "$PROJECT" \
  --format='value(backends[].group)' | grep -q "$NEG"; then
  echo "Backend service $BACKEND already has $NEG"
else
  run gcloud compute backend-services add-backend "$BACKEND" \
    --project "$PROJECT" --global \
    --network-endpoint-group "$NEG" --network-endpoint-group-region "$REGION"
fi
# `create` has no --security-policy flag; it is set with `update`
if [ "$APPLY" = 1 ] && [ "$(gcloud compute backend-services describe "$BACKEND" --global --project "$PROJECT" \
  --format='value(securityPolicy.basename())')" = "$POLICY" ]; then
  echo "Backend service $BACKEND already uses $POLICY"
else
  run gcloud compute backend-services update "$BACKEND" \
    --project "$PROJECT" --global --security-policy "$POLICY"
fi

if [ "$APPLY" = 1 ]; then
  gcloud compute backend-services describe "$BACKEND" --global --project "$PROJECT" \
    --format="table(name,securityPolicy.basename(),logConfig.enable,timeoutSec,backends[0].group.basename())"
  echo "Done. Next: scripts/impact-compat/lb-weight.sh --weight 10 (dry run), then with --apply."
else
  echo "Dry run: nothing changed. Run again with --apply."
fi
