# Development and Android build setup

This guide is the source of truth for bringing a new computer up to speed and
for changing the build workflow. The Windows Android setup below was verified
on a fresh laptop in October 2026. Other operating systems use the same project
versions and commands, replacing `.cmd` launchers with `corepack` and the
platform's Gradle wrapper; the Android Studio refresh helper is Windows-only.

## Project requirements

| Tool | Requirement | Source of truth |
| --- | --- | --- |
| Node.js | 24 or newer (24.19.0 verified) | `package.json` `engines.node` |
| pnpm | **11.19.0 through Corepack** | `package.json` `packageManager` and `engines.pnpm` |
| JDK | 21 for Android Gradle | `android/app/capacitor.build.gradle` |
| Android SDK Platform | 36 | `android/variables.gradle` |
| Android Gradle Plugin | 9.4.0; Gradle wrapper 9.6.0 | `android/build.gradle` and `android/gradle/wrapper/gradle-wrapper.properties` |

Android Studio downloads Gradle and Android dependencies during sync. Use the
committed Gradle wrapper; a separate Gradle installation is unnecessary. Its
built-in JDK may be newer than the JDK 21 this project needs.

## New Windows computer

1. Install Node.js 24 or newer, a JDK 21 distribution, and Android Studio. Open
   a **new** PowerShell window after installation so it sees the new tools.
2. Install Corepack once. Node.js 24 does not include it:

   ```powershell
   npm.cmd install --global corepack@0.34.5
   node.exe --version
   corepack.cmd pnpm --version
   ```

   The pnpm result must be `11.19.0`. Use `corepack.cmd pnpm`, not a separately
   installed global `pnpm`: this laptop had a global 11.25.0 that the project
   correctly rejected. The Windows refresh helper expects Corepack at the
   default npm global path, `%APPDATA%\npm\corepack.cmd`. If
   `(Get-Command corepack.cmd).Source` points elsewhere, update the helper's
   Corepack path for that computer.
3. Clone or update the repository. From the **repository root**, install the
   locked dependencies before opening the Android project. `node_modules` is
   excluded from Git, and Gradle needs the Capacitor packages inside it.

   ```powershell
   corepack.cmd pnpm install --frozen-lockfile
   corepack.cmd pnpm test
   corepack.cmd pnpm build
   corepack.cmd pnpm cap:sync
   ```

   Keep `pnpm-workspace.yaml` unchanged during routine installs. The committed
   `allowBuilds` policy controls dependency build scripts.
4. In Android Studio's SDK Manager, install **Android SDK Platform 36**. Install
   an emulator image, or install Platform-Tools and connect a physical device.
5. Open the repository's **`android/` folder** in Android Studio. In **Settings
   → Build, Execution, Deployment → Build Tools → Gradle**, set **Gradle JDK**
   to the installed JDK 21. Use **Add JDK from disk** if it is not listed. Sync
   the project and wait for it to finish before running the app.
6. Select the **app** run configuration and a device. Configure the automatic
   refresh below, then use **Run** or **Debug**.

Cloud sync needs the public Supabase URL and publishable key from `.env.example`
in a local `.env.local`; the file is excluded from Git. Do not copy a secret key
into a `VITE_` variable. The app can build without cloud sync configured.

## Refresh Capacitor before Android Studio Run/Debug

`corepack.cmd pnpm cap:sync` compiles the web app and copies it into the Android
project. Android Studio does not do this by itself. On Windows, configure this
per computer:

1. From the repository root, get the script's absolute path:

   ```powershell
   (Resolve-Path .\scripts\android-studio-refresh.cmd).Path
   ```

2. In Android Studio, open **Run → Edit Configurations → app → Before launch**.
   Add **Run External tool** and name it `Refresh Capacitor`. Configure:

   | Field | Value |
   | --- | --- |
   | Program | `C:\Windows\System32\cmd.exe` |
   | Arguments | `/d /c C:\full\path\to\roam\scripts\android-studio-refresh.cmd` (use the path from step 1; quote it if it contains spaces) |
   | Working directory | Absolute repository root |

3. Save the tool and ensure it is enabled in **Before launch**. Put the refresh
   above **Gradle-aware Make** so the APK receives the latest web assets.
   [Android Studio runs these tasks in list order](https://developer.android.com/studio/run/rundebugconfig).
   Android Studio stores this tool and run configuration locally; Git does not
   transfer them to another computer.

The helper changes to the repo root itself, adds a standard Windows Node.js
install to `PATH` if present, then calls Corepack. Use `cmd.exe` as the program:
Android Studio failed to start `corepack.cmd` directly on this laptop. Use the
**absolute** script path: a relative `scripts\...` path failed when Android
Studio launched it from another directory.

This hook runs for the configured **Run/Debug** action. Android Studio's Build
menu and command-line Gradle builds do not automatically run Capacitor sync.
For those, sync first:

```powershell
corepack.cmd pnpm cap:sync
Set-Location android
.\gradlew.bat assembleDebug
```

The debug APK is at `android/app/build/outputs/apk/debug/app-debug.apk`. On
other operating systems, use `corepack pnpm cap:sync` and
`./gradlew assembleDebug` from `android/`.

## Troubleshooting

| Symptom | Check or fix |
| --- | --- |
| `Configuring project ':capacitor-app' without an existing directory` | From the repo root, run the frozen pnpm install, then `corepack.cmd pnpm cap:sync`, and sync Gradle again. Git does not include `node_modules`. |
| Gradle cannot find a Java 21 toolchain, or Studio uses its bundled newer JDK | Install JDK 21 and select it as **Gradle JDK** in Android Studio. If a local `android/gradle/gradle-daemon-jvm.properties` requests another version, inspect or remove that local file before syncing. |
| `Cannot run program ...corepack.cmd` | Set the External Tool **Program** to `C:\Windows\System32\cmd.exe` and **Arguments** to `/d /c` plus the refresh script's full path. |
| `The system cannot find the path specified` while running `scripts\android-studio-refresh.cmd` | Replace the relative script path in **Arguments** with its absolute path. The helper itself changes to the repo root. |
| The error still names a previously configured program or path | Restart Android Studio after editing an External Tool configuration on disk; a running Studio process can keep the old setting in memory. |
| `ERR_PNPM_UNSUPPORTED_ENGINE` with pnpm other than 11.19.0 | Run through Corepack and confirm `corepack.cmd pnpm --version` returns `11.19.0`. |
| No Android device is available | Create an emulator in Device Manager or connect a device with USB debugging enabled. |

## Keeping this guide current

When changing Node/pnpm requirements, dependencies, build scripts, Capacitor
sync, Android SDK/JDK/Gradle versions, or Android Studio run behavior, update
this guide in the same change. Keep the quick link in `README.md` accurate. Run
`corepack.cmd pnpm test` and `corepack.cmd pnpm build` after build or dependency
changes, and run `corepack.cmd pnpm cap:sync` plus an Android build when native
behavior changes.
