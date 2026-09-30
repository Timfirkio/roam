# Sessions startup investigation — 30 September 2026

## Confirmed cause

Commit `da6a86c` added a list-time audit of saved rides. Opening Sessions scheduled route reconciliation after 750 ms, then repeated it for the remaining history. `sessionRouteFor` fetched and decoded network tiles before calling synchronous `discoverRouteSegments` on the UI thread. The matching loop scans road candidates for every GPS sample and performs Turf geometry calculations.

Although the surrounding function returned a Promise, the matching calculation did not yield. Navigation clicks and the shared scroll/title-scaling handler could not execute during it. Settings did not trigger this audit.

The audit cache used point-array and discovery-array identity. It was lost on app reload, and fresh arrays from cloud sync could invalidate it. Empty routes or failed lookups could also be retried repeatedly because only successful, nonempty routes were recorded as audited.

## Local browser measurements

Temporary `performance.now()` spans around route matching and a `PerformanceObserver` for UI-thread long tasks were recorded through the local Vite app. The diagnostic instrumentation was removed after verification. These are desktop development measurements, not phone timings or a production benchmark.

| Capture | Observed result |
| --- | --- |
| Before removing the list audit | Four route-matching calls took 1,668, 1,594, 1,649, and 1,680 ms; corresponding UI tasks lasted 1,675, 1,600, 1,655, and 1,687 ms. Each route had 1,000 points and 5,604–6,783 candidates. |
| After removing the list audit | No repeated route-matching stalls. The recorded Sessions long tasks were 229, 64, 239, and 53 ms during startup; no further UI long tasks appeared during the subsequent browsing/detail check. The shorter startup tasks were not individually attributed. |
| Thumbnail cache | 38 saved sessions, 37 with a current cached thumbnail, 2 cards eligible near the viewport. No generation was logged; the missing offscreen thumbnail was not rendered. |
| Requested detail page | Its loading state appeared immediately, followed by road statistics and regions from the worker-backed calculation. No additional UI long task was recorded for this check. |

Title state was also checked at the top (`scale: 1`) and at 64 px of scroll (`scale: 0.34375`, equivalent to the 22 px compact title at that desktop width), then back at the top. This verifies the states; it is not a frame-by-frame animation benchmark.

## Fix and cache behavior

- Removed the automatic whole-history audit from Sessions list entry. The list uses saved statistics; detail pages still correct and save a ride's new-road distance when requested.
- Moved detail route fetching, tile decoding, and matching into a lazy module worker. Requests are serialized; an idle worker is terminated after 30 seconds to release its tile cache. Completed routes remain in the existing in-memory detail cache.
- Thumbnails remain persisted locally as blobs with a style version in IndexedDB. Reopening a tab does not invalidate them. Missing or outdated thumbnails are generated one at a time for cards intersecting the viewport plus a 300 px margin. Generation stops when leaving the list.
- The app currently reads all saved session records and thumbnail blobs at startup. This is distinct from decoding/displaying all thumbnail images. The list initially mounts eight cards and appends eight near its end; cached images use native lazy loading and asynchronous decoding.
- Both top-level titles use the same `measureMorphingPageHeading` / `updateMorphingPageHeading` functions and CSS. Their React markup is separate; `PageNavigation` is the shared subpage bar.

Regression coverage checks worker response routing, failure/retry, idle resource release, and reuse of detail calculations across visits. Do not reintroduce list-wide route matching on the UI thread.
