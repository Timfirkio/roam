# Roam area catalog deployment

This Compose stack runs a private PostGIS catalog, the authenticated Roam area
API, Caddy for HTTPS, and a manual single-process OSM importer. Postgres is not
published to the host; only Caddy exposes ports 80 and 443.

## First deployment

1. Point an `A` record for `areas.your-domain.example` to the server IPv4 and,
   if used, an `AAAA` record to its IPv6. Confirm both records have propagated.
2. Copy `.env.areas.production.example` to `.env.areas.production` and replace
   every placeholder. `AREA_ALLOWED_ORIGIN` is a comma-separated allowlist of
   frontend origins. Include the public web origin and, for the Android app,
   `http://localhost,https://localhost,capacitor://localhost`. Do not use a
   Supabase service-role key here.
3. Start the catalog:

   ```bash
   docker compose --env-file .env.areas.production up -d --build
   docker compose --env-file .env.areas.production ps
   ```

4. Check that the database migration and API are healthy:

   ```bash
   docker compose --env-file .env.areas.production logs --tail=100 postgres area-api caddy
   ```

## Import a regional OSM extract

Download a `.osm.pbf` extract into the ignored `data/` directory. Begin with a
small extract. The `importer` profile is intentionally manual so two imports
cannot accidentally run at once.

```bash
mkdir -p data
# Place a PBF at data/stockholm.osm.pbf, then:
docker compose --env-file .env.areas.production --profile import run --rm importer stockholm SE /data/stockholm.osm.pbf
```

When a larger catalog supersedes an overlapping smaller one, pass the old
catalog ID with `--replace-region`; this keeps OSM relation IDs unique. Queue
stored road-length totals after an import, then process the queue with one or
two workers:

```bash
docker compose --env-file .env.areas.production --profile import build importer
docker compose --env-file .env.areas.production --profile import run --rm -e IMPORT_REPLACE_REGIONS=stockholm importer stockholm-county SE /data/stockholm-county.osm.pbf
docker compose --env-file .env.areas.production run --rm --no-deps area-api node scripts/queue-area-coverage.mjs stockholm-county 4 10
docker compose --env-file .env.areas.production run --rm --no-deps area-api node scripts/process-area-coverage.mjs 2
```

`deploy/run-stockholm-county-import.sh` is the corresponding one-time job for
the county-sized OsmAnd extract. It safely prevents overlapping runs, replaces
the older Stockholm-city catalog, saves a local pre-import database dump, and
calculates levels 4–10. Schedule that
script once with systemd for an overnight run; do not put it in a recurring
cron job unless you also intend to refresh the catalog regularly.

For a larger extract, temporarily rescale or create a short-lived importer
server with more memory. Do not run a country-sized `osm2pgsql` import on the
CPX22.

## Incremental Sweden catalog on a CPX22

`deploy/run-sweden-batches.sh` is the low-cost alternative to a national road
import. It reserves 15 GB of disk, holds a host-wide lock, and runs one job at
a time. The first job reads the Sweden PBF once but stores administrative
boundaries only (levels 2–9); it does not import the national road network.
Subsequent `next` jobs scan the local PBF with one län bounding box, trim roads
to the actual administrative polygon, and calculate that län's total plus its
municipality and level-9 totals using one worker. The län total is measured
directly against its boundary; summing municipality totals can count roads on
shared borders twice.

```bash
# Creates the nationwide boundary/search catalog and the 21-län manifest.
./deploy/run-sweden-batches.sh bootstrap

# Run one county at a time, preferably overnight.
./deploy/run-sweden-batches.sh next

# Inspect pending, running, ready, and failed county batches.
./deploy/run-sweden-batches.sh status
```

Keep `data/sweden-latest.osm.pbf` between batches (about 0.8 GB) so counties
can be clipped locally. Each temporary county extract is removed on completion.
After deploying this change, backfill län totals for batches already marked
ready without reimporting their roads:

```bash
docker compose --env-file .env.areas.production run --rm --no-deps area-api node scripts/backfill-sweden-lan-coverage.mjs
```

After every county is ready, queue the country-level total once to produce the
final nationwide coverage.

To schedule one batch nightly after the bootstrap completes:

```bash
cp deploy/systemd/roam-sweden-batch.service /etc/systemd/system/
cp deploy/systemd/roam-sweden-batch.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now roam-sweden-batch.timer
systemctl list-timers roam-sweden-batch.timer
```

## Update the app

Build the frontend with:

```dotenv
VITE_AREA_CATALOG=true
VITE_AREA_API_URL=https://areas.your-domain.example/api/areas
```

The app's existing Supabase session supplies the access token to the area API.

Do not expose the API over plain HTTP: every authenticated request includes a
Supabase access token. While waiting for DNS, set `CADDY_SITE_ADDRESS=:80` plus
`CADDY_HTTP_BIND=127.0.0.1:80` and `CADDY_HTTPS_BIND=127.0.0.1:443` in the
server environment file. Remove those two bind settings and set the hostname
only after DNS is live; Caddy will then obtain and renew HTTPS certificates.
