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

### New Windows machine

Install Node.js 24 LTS, Android Studio, and JDK 21. In Android Studio's SDK
Manager, install Android SDK Platform 36 (the project's `compileSdk`) and an
emulator image or the SDK Platform-Tools for a physical device. The Android
Gradle build needs JDK 21 even if Android Studio bundles a newer JDK.

Node.js 24 does not bundle Corepack. Install it once in PowerShell:

```powershell
npm.cmd install --global corepack@0.34.5
```

From the repository root, install the locked JavaScript dependencies **before**
opening `android/` in Android Studio. Gradle reads Capacitor modules from
`node_modules`, which Git does not contain:

```powershell
corepack.cmd pnpm install --frozen-lockfile
corepack.cmd pnpm cap:sync
corepack.cmd pnpm android:open
```

For the Android Studio **app** Run/Debug configuration, add a **Before launch →
Run External tool** task named `Refresh Capacitor`. Set its program to
`C:\Windows\System32\cmd.exe`, arguments to
`/d /c scripts\android-studio-refresh.cmd`, and working directory to the
repository root. This runs the web build and syncs
Capacitor before each **Run** or **Debug**. The setting is local to Android
Studio on this machine, so repeat it if you recreate the IDE configuration.

For a command-line debug build, run `corepack.cmd pnpm cap:sync`, then
`cd android` followed by `.\gradlew.bat assembleDebug`. The APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`.

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
- [Navigation and overlay framework](docs/NAVIGATION.md)
- [On-demand OSM area progress setup](docs/AREA_PROGRESS.md)
