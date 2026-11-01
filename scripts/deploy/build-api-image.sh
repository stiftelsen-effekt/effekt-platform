#!/usr/bin/env bash
# Builds the API image (apps/api/Dockerfile) in Cloud Build and pushes it as IMAGE (cloud.deploy.yaml).
#
# Every Cloud Build machine starts with an empty Docker cache, so this builds with BuildKit
# (buildx, docker-container driver) and keeps the layer cache of every stage in the registry,
# at CACHE: when the lockfile and the API's package.json haven't changed, neither install runs
# again and the dependency layers aren't pushed again. Only the compiled API is new.
#
# Usage: build-api-image.sh IMAGE CACHE   (run from the repository root)
set -euo pipefail

image="$1"
cache="$2"

# network=cloudbuild: the builder container reaches the registry like the build steps do
docker buildx create --name api-builder --driver docker-container \
  --driver-opt network=cloudbuild,image=mirror.gcr.io/moby/buildkit:buildx-stable-1 --use >/dev/null
# The push to the registry now and then fails on its own ("failed to authorize: DeadlineExceeded:
# context deadline exceeded" after 60s, while authorizing the push). Retry the whole build:
# the builder keeps its local cache, so a retry rebuilds nothing and only pushes again.
attempts=3
for attempt in $(seq 1 "$attempts"); do
  if docker buildx build \
    --file apps/api/Dockerfile \
    --tag "$image" \
    --cache-from "type=registry,ref=$cache" \
    --cache-to "type=registry,ref=$cache,mode=max,image-manifest=true,oci-mediatypes=true" \
    --provenance=false \
    --push \
    .; then
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "build-api-image: build or push failed (attempt $attempt of $attempts), retrying in $((attempt * 15))s" >&2
    sleep $((attempt * 15))
  fi
done
echo "build-api-image: build or push failed $attempts times" >&2
exit 1
