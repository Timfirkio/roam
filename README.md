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
- Capacitor as the mobile packaging path after the PWA loop works

## Local development

```bash
npm install
npm run dev
```

The map provider and tile key will be configured through `.env.local` once the map shell is implemented. Never commit API keys.

## Product documents

- [Build plan](docs/BUILD_PLAN.md)
- [Architecture notes](docs/ARCHITECTURE.md)

