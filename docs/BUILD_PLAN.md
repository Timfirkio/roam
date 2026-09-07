# Roam build plan

## Product thesis

Roam should make ordinary movement feel collectible: every outing contributes to a persistent map of places the player has personally explored. The map is the primary interface; stats and rewards reinforce the habit without turning Roam into a navigation app.

## MVP success criteria

- A user can open Roam on Android as an installable PWA.
- The app can request location permission, show the current position, and record an active session.
- A route is converted into discovered road progress with sensible GPS tolerance.
- Progress survives refresh and a later session on the same device.
- The user can see discovered versus undiscovered roads and completion for the current region.
- Tracking is usable for a normal ride without obvious runaway battery or memory usage.

## Scope sequence

### Slice 0 — map and interaction shell

- Mobile-first layout with a full-screen map and a compact session control.
- MapLibre style with a dark, quiet visual system.
- Device-location marker, permission/error states, and a fake route fixture for development.
- Region selector kept simple: current viewport or a configured starting region.

### Slice 1 — real tracking and local progress

- Start/pause/finish session state machine.
- Location sampling policy: adaptive distance/time thresholds, not maximum-frequency GPS.
- Simplify the recorded line before processing.
- Snap or match route points to stable road segment IDs from the chosen tile/data source.
- Store discovered segments, session metadata, and region aggregates in IndexedDB.
- Show a discovery animation only when a segment becomes newly complete.

### Slice 2 — progress that feels rewarding

- Region cards with discovered/total roads and percentage complete.
- Session summary: duration, distance, new roads, repeat roads, and road types.
- Milestones/badges as data-driven rules, with one or two simple rewards.
- Install prompt, offline-friendly shell, and recovery after app reload.

### Slice 3 — account and sync

- Optional email/Google sign-in.
- Supabase schema for users, sessions, discovered segments, and region aggregates.
- Idempotent sync queue so local tracking never depends on a network connection.
- Conflict policy: discovered roads are a set union; sessions are append-only.

### Later

- GPX import, then selective integrations (Strava/Komoot/Ride With GPS).
- Offline region packages.
- Social/leaderboards.
- Route-to mode only if it supports exploration rather than replacing a navigation app.

## Key product decisions to validate early

1. What counts as “discovered”: passing within a radius, covering a percentage of a segment, or completing end-to-end?
2. Which road classes belong in the game: roads, cycleways, paths, gravel, or all of them?
3. Is region progress based on administrative boundaries, neighborhoods, or a Roam-defined grid?
4. What visual style remains legible and performant on a mid-range Android phone?
5. How much background tracking is required for the actual use case, and can the MVP stay foreground-only?

## Suggested first issues

- [ ] Bootstrap Vite + React + TypeScript + Tailwind.
- [ ] Add map provider abstraction and a dark MapLibre map shell.
- [ ] Add location permission state and a mock location mode.
- [ ] Define `Session`, `TrackPoint`, `RoadSegment`, and `RegionProgress` types.
- [ ] Implement IndexedDB repository with a fake-data adapter.
- [ ] Build route-to-road matching as a pure, unit-tested module.
- [ ] Add session controls and local session summary.
- [ ] Add Android install/testing checklist.

## Working rule

Keep every feature behind a small, testable domain module. The map renderer, location source, persistence layer, and sync layer should be replaceable independently.

