#!/usr/bin/env sh
set -eu

# Incrementally builds the Swedish catalog on the CPX22. It never runs a
# country-sized road import: the one national pass stores boundaries only, and
# every subsequent invocation imports exactly one län's road extract.
cd "$(dirname "$0")/.."
ENV_FILE=.env.areas.production
PBF=data/sweden-latest.osm.pbf
PBF_URL=https://download.geofabrik.de/europe/sweden-latest.osm.pbf
MIN_FREE_KB=${ROAM_MIN_FREE_KB:-15728640}
LOCK_FILE=/tmp/roam-sweden-batches.lock
COMMAND=${1:-next}

free_kb() { df -Pk . | awk 'NR == 2 { print $4 }'; }
require_space() {
  available=$(free_kb)
  if [ "$available" -lt "$MIN_FREE_KB" ]; then
    echo "Refusing Sweden import: only $((available / 1024 / 1024)) GB free; keep at least $((MIN_FREE_KB / 1024 / 1024)) GB." >&2
    exit 1
  fi
}

run() {
  exec flock -n "$LOCK_FILE" sh -c '
    set -eu
    cd "'"$(pwd)"'"
    command="'"$COMMAND"'"
    require_space() { available=$(df -Pk . | awk "NR == 2 { print \$4 }"); [ "$available" -ge "'"$MIN_FREE_KB"'" ] || { echo "Insufficient free disk space." >&2; exit 1; }; }
    require_space
    mkdir -p data backups
    docker compose --env-file "'"$ENV_FILE"'" --profile import build importer
    case "$command" in
      bootstrap)
        if [ ! -s "'"$PBF"'" ]; then
          curl --fail --location --retry 4 --retry-delay 15 --output "'"$PBF"'.part" "'"$PBF_URL"'"
          mv "'"$PBF"'.part" "'"$PBF"'"
        fi
        docker compose --env-file "'"$ENV_FILE"'" exec -T postgres sh -c "pg_dump -U \"\$POSTGRES_USER\" \"\$POSTGRES_DB\"" > "backups/pre-sweden-boundaries-$(date -u +%Y%m%dT%H%M%SZ).sql"
        docker compose --env-file "'"$ENV_FILE"'" --profile import run --rm -e OSM2PGSQL_CACHE_MB=768 importer sweden-boundaries SE /data/sweden-latest.osm.pbf --boundaries-only --download-url "'"$PBF_URL"'"
        docker compose --env-file "'"$ENV_FILE"'" run --rm --no-deps area-api node scripts/bootstrap-sweden-batches.mjs --reset
        ;;
      next)
        docker compose --env-file "'"$ENV_FILE"'" --profile import run --rm -e OSM2PGSQL_CACHE_MB=768 -e SWEDEN_PBF=/data/sweden-latest.osm.pbf --entrypoint node importer scripts/run-sweden-batch.mjs
        ;;
      status)
        docker compose --env-file "'"$ENV_FILE"'" exec -T postgres psql -U roam_catalog -d roam_catalog -c "select status, count(*) from osm.sweden_batches group by status order by status;"
        ;;
      *) echo "Usage: $0 [bootstrap|next|status]" >&2; exit 2 ;;
    esac
  '
}

run
