# On-demand OSM area progress

## Production catalog: PostGIS, not Overpass

Roam's production path is a PostGIS OSM catalog. The app never queries
Overpass while a user pans the map. A regional importer writes versioned
administrative polygons and eligible road lines to the private `osm` schema;
the area service reads that catalog for point containment, name search,
coverage jobs and vector-tile boundaries.

Apply `supabase/migrations/20260921194924_area_osm_catalog.sql` to enable the
private catalog schema and PostGIS. It deliberately grants no browser role
access to raw OSM tables. The area service connects with a server-only
database URL, while the frontend calls its existing authenticated HTTP API.

```dotenv
# Area service: enables catalog mode and removes runtime Overpass calls.
AREA_DATABASE_URL=postgresql://catalog-importer:password@host:5432/postgres

# Frontend: renders every imported boundary in the current viewport as MVT.
VITE_AREA_CATALOG=true
VITE_AREA_API_URL=https://areas.example.com/api/areas
```

The importer should begin with the Sweden Geofabrik PBF extract, write its
source timestamp into `osm.import_regions`, and only mark it `ready` after
both `osm.boundaries` and `osm.roads` have been indexed. Re-import a region
atomically into a new source version, then retire the prior version. This
ensures a coverage job always sees a consistent boundary/road snapshot.

`osm2pgsql` Flex output is the intended importer: retain only
`boundary=administrative` relations with valid polygon geometry, and the same
eligible `highway` classes used by `road-rules.ts`. Store both WGS84 and Web
Mercator geometry, create the supplied GiST indexes, and run daily regional
updates through a single import queue. Country imports can be requested on
demand; while an import is queued, the API should return a deliberate
“preparing this region” state rather than attempting an external lookup.

Install `osm2pgsql` on the import worker, obtain a regional PBF extract, then
run the importer with a non-browser database role that owns the private import
schemas:

```powershell
corepack pnpm areas:import-region sweden-2026-09-21 SE C:\osm\sweden-latest.osm.pbf
```

The importer writes to staging tables first and swaps the region into the
catalog inside one transaction. It is intentionally a single-worker command;
the production scheduler must not import the same region concurrently.

The catalog API adds `GET /api/areas/tiles/{z}/{x}/{y}.mvt`. PostGIS clips the
stored polygons into a vector tile, so all available administrative boundaries
remain visible at the current map zoom. The coverage worker stores its result
in `osm.coverage_jobs`, keyed by boundary version, OSM source version and road
rules version.

The first slice adds a shared Node 24 area service and an **OSM areas** tab in
Progress. Existing Stockholm progress remains under **Stockholm districts**.
The new service does not access rides or discoveries. Personal coverage is
calculated on the device from existing discoveries, including imported GPX rides.

## Run locally

Use Corepack and the repository's pnpm 11.19.0:

```powershell
corepack pnpm install --frozen-lockfile
# Create .env.areas with the settings below, then use two terminals:
corepack pnpm areas:serve
corepack pnpm dev
```

`.env.areas` (ignored by Git), for the legacy development fallback only:

```dotenv
# Required: a self-hosted or contracted Overpass endpoint suitable for app traffic.
AREA_OVERPASS_URL=https://your-overpass-host/api/interpreter
# Defaults shown below:
AREA_HOST=127.0.0.1
AREA_PORT=8787
AREA_DATA_DIR=.roam-data
AREA_MAX_TILES=1024
# Required for the Progress map's sticky location search. Use a hosted or
# contracted Nominatim-compatible geocoder in production.
AREA_GEOCODER_URL=https://your-geocoder-host/search
```

There is deliberately no default public Overpass endpoint. Public instances are
appropriate for occasional manual experiments, not Roam's production backend.
The configured provider must support `is_in`, area tags, and relation `out geom`.

Vite proxies `/api/areas` to localhost:8787. For an Android build or separately
hosted frontend, set `VITE_AREA_API_URL=https://your-area-host/api/areas` at build
time. A static frontend deployment alone cannot run this worker.

The Progress map uses the current zoom to choose which enclosing administrative
boundary to show: country at overview zoom, then regional, municipality and
smallest available local boundary at street zoom. Search is proxied through the
worker, cached for seven days, and must not point at a public geocoder for a
production application.

For a remote worker set `AREA_HOST=0.0.0.0`, `AREA_ALLOWED_ORIGIN` to the exact
frontend origin, and `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`. Every request
then validates a Supabase access token; the frontend uses its existing session.
No service-role key or schema migration is needed. Keep the worker behind HTTPS
and an ingress rate limiter. Do not expose the unauthenticated loopback mode
through a public reverse proxy. The built-in IP budget is a backstop, not a
replacement for per-account limits at a production ingress.

Run exactly one worker process against a persistent SQLite volume. This initial
queue does not support multiple worker processes sharing a database. Back up
the SQLite database with its WAL safely, or stop the worker before copying it.

## Data and calculations

- Lookup resolves the administrative areas containing the requested coordinate.
  No fixed six-level global hierarchy is invented. Local labels currently cover
  Sweden, US and Germany; other countries retain the OSM administrative level.
  Areas are displayed by depth without claiming a unique parent relationship.
- Only OSM administrative relations with complete polygons can be calculated.
  Named neighbourhood points, standalone closed ways and non-administrative
  neighbourhood boundaries are not supported by this first provider.
- A boundary is fetched when its coverage is requested. Holes and multipolygons
  are retained; incomplete provider responses fail visibly. Polygon snapshots
  are cached for seven days and checked again on a new calculation request.
- The worker uses the same `road-rules.ts` eligibility rules as discovery and
  z14 OpenFreeMap transportation tiles. By default the source is pinned to the
  committed catalog snapshot; `AREA_TILE_TEMPLATE` can select another **versioned**
  XYZ snapshot. This is an OSM-derived display network, not all raw OSM ways.
- Cache keys include boundary geometry hash, network template and rules version.
  Bump `RULES_VERSION` when eligibility, classification or measurement changes.
  Jobs retain their own polygon and tile list so refreshes cannot change a job
  mid-calculation.
- Clip roads to the tile interior and the administrative polygon. Half-open tile
  ownership removes border duplicates; collinear interval unions remove reversed
  and partial duplicates. Lengths remain floating point until display.
- One job per cache key serves all users. Checkpoints commit after every tile.
  Missing tiles never become an apparently complete denominator. Retry and process
  restart reuse completed checkpoints. Successful decoded tiles are shared across
  jobs, with a 4096-tile LRU limit; job/boundary retention needs operational pruning
  for a large deployment.
- Local areas at admin level 7 or deeper may calculate automatically when opened
  with existing discoveries and requiring at most 32 tiles. Larger requests are
  explicit and bounded by `AREA_MAX_TILES`. Countries commonly exceed the default
  limit; they show a useful error rather than scheduling unbounded downloads.
  Regional extracts / a scalable job runner are needed before country-scale rollout.
- Dateline-spanning and polar polygons fail explicitly in this first XYZ provider.

## Percentage semantics and remaining work

Personal length is the geometric union of saved discovered stretches clipped to
each area's polygon, independent of the old single `regionId`. Parent totals are
calculated against their own polygon, never summed from incomplete child totals.
Overlapping administrative areas intentionally each count their own roads.

Percentages are marked approximate: legacy discovery records do not carry a
network version and are not yet rematched to the denominator's exact snapshot.
If explored length materially exceeds the denominator, the percentage is withheld
and reconciliation is requested rather than silently changing the denominator.
Geometric grouping uses small numerical tolerances; this is not a routing graph
or an OSM-ID-preserving canonical network. Category overlaps can still require
reclassification; the all-road total unions across categories.

Follow-up work: canonical discovery/network identity and rematching, cached offline
area results, automatic area lookup after every ride/import (currently on opening
Progress), durable pending discovery processing, country profile expansion, explicit
boundary parent/child browsing, and an OSM extract provider for large jobs.

## Verification

`corepack pnpm test` includes boundary clipping, holes, islands, duplicate imports,
tile seams, shared results, failed downloads, retry, restart checkpoints, source
version invalidation, and work limits. `corepack pnpm build` validates the frontend.
The service modules run directly with Node 24; no Supabase tables are changed.

Manual check: open Progress, select an explored location outside Stockholm, request
its municipality, wait for a ready result, restart the service and repeat the same
request. It should reuse the result. Stop connectivity during a multi-tile job and
retry: no percentage should appear from an incomplete denominator.
