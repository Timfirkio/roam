# Account sync and egress

Roam stores sessions, GPS points, discovered roads, and rendered session previews on the device. Previews are not uploaded. Account sync sends ride and discovery data to Supabase.

The first successful sync on a device reconciles all cloud rows. It then saves an account-specific checkpoint locally. Later syncs request discoveries after the last `created_at` cursor and rides after the last `updated_at` cursor. Only changed rides have their GPS points downloaded. A database trigger updates the ride timestamp on every edit. The checkpoint is saved only after the local cache update succeeds; if the local cache is lost, the next pass does a full reconciliation. Progress created during a sync remains pending for the next pass.

Sync runs on sign-in, local progress changes, return to the foreground, reconnect, manual refresh, and every 15 minutes while the app is visible. Explicit session deletion still removes that ride's saved GPX across devices; it does not remove explored roads or map progress.

## Verify egress after release

In the Supabase organization Usage view, select the Roam project and compare daily **Egress** (uncached) with days of similar app use. The pre-change September 29 baseline was 25,409 GETs to `/rest/v1/discoveries` and 29,799 GETs to `/rest/v1/ride_session_points`. These represented roughly 875 full syncs. The first sync on each device after release still downloads everything; subsequent idle syncs should request no GPS point pages and only small discovery/ride delta queries.

In Supabase Observability, compare **Database API → API Egress** and the request counts for those two paths. Egress resets at the next billing cycle; usage already incurred in the current cycle remains on the dashboard. If the counts do not fall, check whether the released client includes this change and whether browser storage is retaining the checkpoint.
