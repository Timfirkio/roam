# Roam architecture notes

## Recommendation

Start as a React PWA and package it with Capacitor only after foreground tracking, persistence, and the map experience work on a real Android device. This keeps one UI codebase while leaving an escape hatch for native location/background capabilities.

## Boundaries

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

