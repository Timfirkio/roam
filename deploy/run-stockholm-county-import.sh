#!/usr/bin/env sh
set -eu

# One-time Stockholm County catalog job. Run this from /srv/roam-areas as root.
# The PBF is the county-sized OsmAnd extract, avoiding a memory-heavy Sweden
# import on the CPX22. The previous Stockholm-city source is replaced because
# OSM relations can occur in both extracts.
cd "$(dirname "$0")/.."
ENV_FILE=.env.areas.production
PBF=data/sweden_stockholm_europe.pbf
PBF_URL=https://builder.osmand.net/osm-extract/sweden_stockholm_europe/sweden_stockholm_europe.pbf
LOCK_FILE=/tmp/roam-stockholm-county-import.lock

exec flock -n "$LOCK_FILE" sh -c '
  set -eu
  mkdir -p data
  curl --fail --location --retry 4 --retry-delay 15 --output "'"$PBF"'.part" "'"$PBF_URL"'"
  mv "'"$PBF"'.part" "'"$PBF"'"
  docker compose --env-file "'"$ENV_FILE"'" --profile import run --rm importer stockholm-county SE /data/sweden_stockholm_europe.pbf --replace-region stockholm --download-url "'"$PBF_URL"'"
  docker compose --env-file "'"$ENV_FILE"'" run --rm --no-deps area-api node scripts/queue-area-coverage.mjs stockholm-county 4 10
  docker compose --env-file "'"$ENV_FILE"'" run --rm --no-deps area-api node scripts/process-area-coverage.mjs 2
'
