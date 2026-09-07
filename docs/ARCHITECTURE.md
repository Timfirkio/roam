# Roam architecture notes

## Recommendation

Start as a React PWA and package it with Capacitor only after foreground tracking, persistence, and the map experience work on a real Android device. This keeps one UI codebase while leaving an escape hatch for native location/background capabilities.

## Boundaries

### Cycling network zoom detail

The Liberty/OpenFreeMap basemap uses generalized OpenMapTiles transportation
data. Features may be omitted entirely below z14, depending on OSM tags and
route membership; lowering a style layer's minzoom cannot recover them.

Roam's path and discovered-network overlays use `roam-network-detail` from
z12 upward. Its custom MapLibre protocol composes z12/z13 transportation tiles
from their 16/4 z14 children, retaining access/surface tags and transforming
coordinates into the parent tile. Internal child buffers are clipped to avoid
double drawing at seams. At z14 and above, the original z14 tiles are used
and overzoomed normally. The basemap and overview below z12 stay generalized.

This loads complete data on a cold view, without requiring a prior zoom-in.
Requests are abortable, limited to six concurrent fetches per map, and backed
by a 128-tile LRU cache. The tradeoff is additional bandwidth on first loading
z12/z13. Extending full detail below z12 would multiply requests further;
a dedicated cycling tileset generated with consistent low-zoom retention is
the longer-term approach for city/region overviews and mobile efficiency.

`pnpm test` covers coordinate preservation, seams, cold loads, zoom/cache
reuse, cancellation, request limits, and failures. With Node 22.18+,
`node scripts/verify-cycleway.mjs` checks the live geometry of Stockholm OSM
way 434713008. On 2026-09-07 it was absent from provider z12/z13 tiles and
present at z14; the Roam source retained it at all three zooms. Provider tile
IDs represent merged geometry and must not be treated as original OSM way IDs.

References: [OpenMapTiles transportation SQL](https://github.com/openmaptiles/openmaptiles/blob/master/layers/transportation/transportation.sql)
and [example OSM way](https://www.openstreetmap.org/way/434713008).

```text
UI
 ├─ Map renderer (MapLibre)
 ├─ Session controls and progress panels
 └─ Install/offline states

Application
 ├─ Session state machine
 ├─ Location sampling policy
 ├─ Route processing
 └─ Discovery rules

Adapters
 ├─ Browser geolocation / Capacitor geolocation
 ├─ Tile and road-segment provider
 ├─ IndexedDB repository
 └─ Supabase sync repository (later)
```

## Important data model choices

- `RoadSegment.id` must be stable across sessions and tile refreshes. Do not use a transient rendered feature index.
- `TrackPoint` should retain timestamp and accuracy; low-accuracy points should not silently create discoveries.
- Discovery writes should be idempotent. Replaying a session must not inflate counts.
- Keep raw tracks separate from derived discoveries so the matching algorithm can improve later.
- Region progress should be derived from segment sets where possible, not maintained as an untrusted counter.

## Battery and performance guardrails

- Use adaptive GPS sampling based on movement and reported accuracy.
- Process route chunks incrementally instead of rerunning the entire track on every point.
- Keep the 3D treatment limited to a near-zoom presentation mode; use a simpler 2D layer at wider zooms.
- Avoid loading buildings, POIs, labels, and animation until they prove they improve the core loop.
- Measure frame time, GPS wakeups, memory, and battery on an Android test device before adding visual effects.

## Risks

- Road matching is the highest-risk technical area because tile feature IDs may not be stable enough for long-term progress.
- Browser background geolocation is inconsistent; foreground-only tracking is the honest MVP boundary.
- Map tile licensing, attribution, quotas, and offline caching need a provider decision before public release.
- “All roads in Stockholm” can feel impossible; region-sized goals and strong local feedback are core, not polish.
