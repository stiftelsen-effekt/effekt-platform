#!/usr/bin/env bash
# Phase 5 of docs/impact-api-migration.md: send a share of impact.gieffektivt.no/api/* to effektapi.
#
#   scripts/impact-compat/lb-weight.sh --weight 10            # dry run: shows the new URL map
#   scripts/impact-compat/lb-weight.sh --weight 10 --apply    # 10 % to effektapi
#   scripts/impact-compat/lb-weight.sh --weight 0 --apply     # rollback: 100 % legacy
#   scripts/impact-compat/lb-weight.sh --remove --apply       # drop the route rules (as before phase 5)
#
# Edits the `impact` path matcher of URL map effekt-api-lb (host impact.gieffektivt.no):
#   priority 1: header X-Impact-Backend: legacy        → bs-impact-api (the dual-run diff's pin)
#   priority 2: path prefix /api/                      → bs-impact-api (100 − W) / bs-effektapi-impact (W)
#   everything else (/admin, /, scanners)              → bs-impact-api (the path matcher's default)
# No path rewrite: effektapi answers /api/<endpoint> itself when the Host is impact.gieffektivt.no.
# The hostname, certificate and Cloud Armor policy (effekt-api-armor on both backends) stay.
#
# Before applying, the current URL map is exported to $BACKUP_DIR (default ~/impact-lb-backups);
# the script prints the exact rollback commands. bash 3.2 compatible; needs python3 for the JSON.
set -euo pipefail

PROJECT="hidden-display-243419"
URL_MAP="effekt-api-lb"
MATCHER="impact"
LEGACY="bs-impact-api"
NEW="${NEW_BACKEND:-bs-effektapi-impact}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/impact-lb-backups}"
SELF="scripts/impact-compat/lb-weight.sh"

WEIGHT=""
REMOVE=0
APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --weight)
      WEIGHT="${2:-}"
      shift
      ;;
    --weight=*) WEIGHT="${1#--weight=}" ;;
    --remove) REMOVE=1 ;;
    --apply) APPLY=1 ;;
    -h | --help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

if [ "$REMOVE" = 0 ]; then
  case "$WEIGHT" in
    '' | *[!0-9]*)
      echo "Give --weight 0..100 (share to effektapi) or --remove" >&2
      exit 2
      ;;
  esac
  if [ "$WEIGHT" -gt 100 ]; then
    echo "--weight must be 0..100" >&2
    exit 2
  fi
fi

if [ "$REMOVE" = 0 ] && [ "$WEIGHT" -gt 0 ] &&
  ! gcloud compute backend-services describe "$NEW" --global --project "$PROJECT" >/dev/null 2>&1; then
  echo "Backend service $NEW does not exist: run scripts/impact-compat/lb-backend.sh --apply first" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

gcloud compute url-maps describe "$URL_MAP" --global --project "$PROJECT" --format=json >"$work/current.json"

python3 - "$work/current.json" "$work/new.json" "$PROJECT" "$MATCHER" "$LEGACY" "$NEW" "$WEIGHT" "$REMOVE" <<'PY'
import json, sys
src, dst, project, matcher, legacy, new, weight, remove = sys.argv[1:9]
m = json.load(open(src))
base = f"https://www.googleapis.com/compute/v1/projects/{project}/global/backendServices/"
# Output-only fields; fingerprint stays so a concurrent change makes the import fail
for k in ("id", "creationTimestamp", "selfLink", "kind"):
    m.pop(k, None)
pm = next((p for p in m["pathMatchers"] if p["name"] == matcher), None)
if pm is None:
    sys.exit(f"path matcher {matcher} not found")
if pm.get("pathRules"):
    sys.exit(f"path matcher {matcher} has pathRules; this script only manages routeRules")
if remove == "1":
    pm.pop("routeRules", None)
else:
    w = int(weight)
    pm["routeRules"] = [
        {
            "priority": 1,
            "description": "impact compat diff: pinned to the legacy impact API",
            "matchRules": [
                {
                    "prefixMatch": "/",
                    "headerMatches": [{"headerName": "X-Impact-Backend", "exactMatch": "legacy"}],
                }
            ],
            "service": base + legacy,
        },
        {
            "priority": 2,
            "description": f"impact API: {w} % to effektapi (docs/impact-api-migration.md phase 5)",
            "matchRules": [{"prefixMatch": "/api/"}],
            "routeAction": {
                "weightedBackendServices": [
                    {"backendService": base + legacy, "weight": 100 - w},
                    {"backendService": base + new, "weight": w},
                ]
            },
        },
    ]
json.dump(m, open(dst, "w"), indent=2)
PY

echo "Path matcher '$MATCHER', before:"
python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(json.dumps(next(p for p in m["pathMatchers"] if p["name"]=="impact"), indent=2))' "$work/current.json"
echo
echo "After:"
python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); print(json.dumps(next(p for p in m["pathMatchers"] if p["name"]=="impact"), indent=2))' "$work/new.json"
echo

echo "Validating..."
gcloud compute url-maps validate --global --project "$PROJECT" --source "$work/new.json" \
  --load-balancing-scheme EXTERNAL_MANAGED --format="value(result.loadSucceeded,result.loadErrors)"

if [ "$APPLY" = 0 ]; then
  echo "Dry run: nothing changed. Run again with --apply."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
backup="$BACKUP_DIR/$URL_MAP-$(date -u +%Y%m%dT%H%M%SZ).yaml"
gcloud compute url-maps export "$URL_MAP" --global --project "$PROJECT" --destination "$backup"
echo "Backup: $backup"

gcloud compute url-maps import "$URL_MAP" --global --project "$PROJECT" --source "$work/new.json" --quiet

echo
if [ "$REMOVE" = 1 ]; then
  echo "Route rules removed: impact.gieffektivt.no goes to $LEGACY only."
else
  echo "Applied: impact.gieffektivt.no/api/* → $NEW $WEIGHT %, $LEGACY $((100 - WEIGHT)) %."
fi
echo "Changes reach the edge within a few minutes."
echo
echo "Rollback (100 % legacy, keeps the rules):"
echo "  $SELF --weight 0 --apply"
echo "Rollback to exactly the URL map before this change:"
echo "  gcloud compute url-maps import $URL_MAP --global --project $PROJECT --source $backup --quiet"
