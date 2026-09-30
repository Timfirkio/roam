import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredSegment } from './discovery';
import type { RideSession } from './session-store';

const { reconcileSessionRoute, lookupSessionRegions, loadArea, calculateExploredAreaTotals } = vi.hoisted(() => ({
  reconcileSessionRoute: vi.fn(), lookupSessionRegions: vi.fn(), loadArea: vi.fn(), calculateExploredAreaTotals: vi.fn(),
}));
vi.mock('./session-route-reconciliation', () => ({ reconcileSessionRoute }));
vi.mock('./session-regions', () => ({ lookupSessionRegions }));
vi.mock('./area-client', () => ({ loadArea }));
vi.mock('./area-progress-calculation', () => ({
  exploredTotalsKey: () => 'area-key', calculateExploredAreaTotals,
}));

const segment: DiscoveredSegment = {
  id: 'road:0', roadType: 'paved-road', lengthMeters: 100, discoveredAt: 150,
  geometry: { type: 'LineString', coordinates: [[18, 59], [18.001, 59]] },
};
const session: RideSession = {
  id: 'ride-1', title: 'Ride', districtNames: [], startedAt: 100, endedAt: 200,
  durationSeconds: 100, distanceMeters: 100, newDistanceMeters: 100,
  points: [{ lng: 18, lat: 59, timestamp: 100, accuracy: 5 }],
};

describe('session detail data cache', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shares work between visits and publishes region figures together once', async () => {
    const { sessionDetailEntry } = await import('./session-detail-data');
    reconcileSessionRoute.mockResolvedValue([segment]);
    lookupSessionRegions.mockResolvedValue({
      areasBySegment: new Map([[segment.id, [{ area: { id: 'area', name: 'Area', adminLevel: 7, boundaryVersion: 1 }, job: { status: 'ready', totals: { lengthMeters: 1000 } } }]]]),
      failed: 0, sampled: 1,
    });
    loadArea.mockResolvedValue({ area: { id: 'area', boundaryVersion: 1, geometry: { type: 'Polygon', coordinates: [[[17, 58], [19, 58], [19, 60], [17, 58]]] } } });
    calculateExploredAreaTotals.mockResolvedValue({ lengthMeters: 300 });
    const discoveries = [segment];
    const entry = sessionDetailEntry(session, discoveries);
    const snapshots: string[] = [];
    entry.subscribe(() => snapshots.push(`${entry.getSnapshot().routeStatus}/${entry.getSnapshot().regionStatus}`));

    await Promise.all([entry.load(), sessionDetailEntry(session, discoveries).load()]);

    expect(sessionDetailEntry(session, discoveries)).toBe(entry);
    expect(sessionDetailEntry({ ...session, thumbnailStyleVersion: 5 }, discoveries)).toBe(entry);
    expect(reconcileSessionRoute).toHaveBeenCalledTimes(1);
    expect(lookupSessionRegions).toHaveBeenCalledTimes(1);
    expect(loadArea).toHaveBeenCalledTimes(1);
    expect(calculateExploredAreaTotals).toHaveBeenCalledTimes(1);
    expect(snapshots).toEqual(['ready/loading', 'ready/ready']);
    expect(entry.getSnapshot().exploredByRegion).toEqual({ area: 300 });
    await entry.load();
    expect(lookupSessionRegions).toHaveBeenCalledTimes(1);
  });

  it('stops unfinished region lookups when the page closes and resumes on revisit', async () => {
    const { sessionDetailEntry } = await import('./session-detail-data');
    reconcileSessionRoute.mockResolvedValue([segment]);
    lookupSessionRegions.mockImplementationOnce((_: DiscoveredSegment[], signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    })).mockResolvedValueOnce({ areasBySegment: new Map(), failed: 0, sampled: 1 });
    const entry = sessionDetailEntry({ ...session, id: 'ride-2', points: [...session.points] }, [segment]);
    const unsubscribe = entry.subscribe(() => {});
    const firstLoad = entry.load();
    await vi.waitFor(() => expect(lookupSessionRegions).toHaveBeenCalledTimes(1));
    unsubscribe();
    await firstLoad;
    expect(entry.getSnapshot().routeStatus).toBe('ready');
    expect(entry.getSnapshot().regionStatus).toBe('loading');

    const unsubscribeAgain = entry.subscribe(() => {});
    await entry.load();
    expect(lookupSessionRegions).toHaveBeenCalledTimes(2);
    expect(reconcileSessionRoute).toHaveBeenCalledTimes(1);
    expect(entry.getSnapshot().regionStatus).toBe('ready');
    unsubscribeAgain();
  });
});
