# Roam

Roam is a mobile-first exploration game that turns local movement into visible progress. As you walk or ride, the app records your route and reveals the roads you have explored.

## Status

Early MVP scaffold. The first vertical slice is intentionally local-first:

1. Load a map centered on the device.
2. Start a walking/riding session.
3. Track a GPS path while the app is active.
4. Match the path to road segments and reveal them.
5. Persist discovered segments and show region progress.

## Proposed stack

- React + TypeScript + Vite
- Tailwind CSS
- MapLibre GL JS, with Deck.gl only where it adds measurable value
- OpenStreetMap-derived vector tiles (provider to be selected)
- Turf.js for client-side geometry operations
- IndexedDB for the MVP's offline/local-first state
- Supabase/PostGIS when sync, accounts, and leaderboards are validated
- Capacitor for the Android shell and native device APIs

## Local development

```bash
pnpm install --frozen-lockfile
pnpm dev
```

## Android development

The repository now includes a Capacitor Android project in `android/`. The normal
native development loop is:

```bash
pnpm cap:sync
pnpm android:open
```

Open the generated project in Android Studio, choose an Android device, and run it.
The app uses Capacitor Geolocation for live GPS fixes on Android and retains the
browser implementation on the web.

### Background ride recording

The current integration deliberately records only while the app is foregrounded.
Reliable Android background tracking needs a native foreground location service,
a persistent notification, and a separate background-location permission flow.
The next implementation step is to add that service and persist its fixes locally
so the web layer can recover the route when the app is reopened. It should not be
implemented as a plain WebView geolocation watch: Android will pause or stop that
when the app is backgrounded.

The map provider and tile key will be configured through `.env.local` once the map shell is implemented. Never commit API keys.

## Product documents

- [Build plan](docs/BUILD_PLAN.md)
- [Architecture notes](docs/ARCHITECTURE.md)
