# On-demand OSM area progress

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

`.env.areas` (ignored by Git):

```dotenv
# Required: a self-hosted or contracted Overpass endpoint suitable for app traffic.
AREA_OVERPASS_URL=https://your-overpass-host/api/interpreter
# Defaults shown below:
AREA_HOST=127.0.0.1
AREA_PORT=8787
AREA_DATA_DIR=.roam-data
AREA_MAX_TILES=1024
```

There is deliberately no default public Overpass endpoint. Public instances are
appropriate for occasional manual experiments, not Roam's production backend.
The configured provider must support `is_in`, area tags, and relation `out geom`.

Vite proxies `/api/areas` to localhost:8787. For an Android build or separately
hosted frontend, set `VITE_AREA_API_URL=https://your-area-host/api/areas` at build
time. A static frontend deployment alone cannot run this worker.

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
