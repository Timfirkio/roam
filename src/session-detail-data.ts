import type { DiscoveredSegment } from './discovery';
import type { RideSession, SessionPoint } from './session-store';
import { reconcileSessionRoute } from './session-route-reconciliation';
import { sessionAnalytics, summarizeSessionRegions } from './session-analytics';
import { lookupSessionRegions } from './session-regions';
import { loadArea } from './area-client';
import { calculateExploredAreaTotals, exploredTotalsKey } from './area-progress-calculation';

type Analytics = ReturnType<typeof sessionAnalytics>;
type Regions = ReturnType<typeof summarizeSessionRegions>;

export type SessionDetailSnapshot = {
  analytics: Analytics | null;
  regions: Regions | null;
  exploredByRegion: Record<string, number>;
  routeStatus: 'loading' | 'ready' | 'error';
  regionStatus: 'loading' | 'ready' | 'error';
};

export type SessionDetailEntry = {
  getSnapshot: () => SessionDetailSnapshot;
  subscribe: (listener: () => void) => () => void;
  load: () => Promise<void>;
};

const routeCache = new WeakMap<SessionPoint[], Promise<DiscoveredSegment[]>>();
const detailCache = new WeakMap<SessionPoint[], Map<string, WeakMap<DiscoveredSegment[], SessionDetailEntry>>>();

function routeFor(points: SessionPoint[]) {
  let pending = routeCache.get(points);
  if (!pending) {
    pending = reconcileSessionRoute(points, new Set()).catch(error => {
      routeCache.delete(points);
      throw error;
    });
    routeCache.set(points, pending);
  }
  return pending;
}

/** Derived session data is shared between visits while its source objects stay current. */
export function sessionDetailEntry(session: RideSession, discoveries: DiscoveredSegment[]): SessionDetailEntry {
  let byRide = detailCache.get(session.points);
  if (!byRide) {
    byRide = new Map();
    detailCache.set(session.points, byRide);
  }
  let byDiscoveries = byRide.get(session.id);
  if (!byDiscoveries) {
    byDiscoveries = new WeakMap();
    byRide.set(session.id, byDiscoveries);
  }
  const cached = byDiscoveries.get(discoveries);
  if (cached) return cached;

  let snapshot: SessionDetailSnapshot = {
    analytics: null, regions: null, exploredByRegion: {}, routeStatus: 'loading', regionStatus: 'loading',
  };
  let pending: Promise<void> | null = null;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<SessionDetailSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  const entry: SessionDetailEntry = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && snapshot.regionStatus === 'loading') controller?.abort();
      };
    },
    load: () => {
      if (snapshot.regionStatus !== 'loading') return Promise.resolve();
      if (pending) return controller?.signal.aborted ? pending.then(() => entry.load()) : pending;
      const currentController = new AbortController();
      controller = currentController;
      const work = (async () => {
        let analytics: Analytics;
        try {
          analytics = snapshot.analytics ?? sessionAnalytics(session, await routeFor(session.points), discoveries);
          if (snapshot.routeStatus !== 'ready') publish({ analytics, routeStatus: 'ready' });
        } catch {
          publish({ routeStatus: 'error', regionStatus: 'error' });
          return;
        }
        if (currentController.signal.aborted) return;

        try {
          const newSegments = analytics.newSegments;
          const result = newSegments.length ? await lookupSessionRegions(newSegments, currentController.signal) : { areasBySegment: new Map(), failed: 0, sampled: 0 };
          if (currentController.signal.aborted) return;
          const regions = summarizeSessionRegions(newSegments, result.areasBySegment);
          const exploredByRegion: Record<string, number> = {};
          const eligible = regions.filter(region => region.total !== null);
          for (let start = 0; start < eligible.length; start += 4) {
            if (currentController.signal.aborted) return;
            await Promise.all(eligible.slice(start, start + 4).map(async region => {
              try {
                const record = await loadArea(region.id, currentController.signal, true);
                if (!record.area.geometry) return;
                const areaKey = `${record.area.id}:${record.area.boundaryVersion}`;
                const key = exploredTotalsKey(discoveries, areaKey, record.area.geometry);
                const totals = await calculateExploredAreaTotals(discoveries, record.area.geometry, key, areaKey);
                if (!currentController.signal.aborted) exploredByRegion[region.id] = totals.lengthMeters;
              } catch { /* Ride contribution remains available when overall coverage fails. */ }
            }));
          }
          if (currentController.signal.aborted) return;
          publish({ regions, exploredByRegion, regionStatus: result.sampled > 0 && result.failed === result.sampled ? 'error' : 'ready' });
        } catch {
          if (!currentController.signal.aborted) publish({ regionStatus: 'error' });
        }
      })();
      const result = work.finally(() => { if (pending === result) { pending = null; controller = null; } });
      pending = result;
      return pending;
    },
  };
  byDiscoveries.set(discoveries, entry);
  return entry;
}
