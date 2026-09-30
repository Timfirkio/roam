import { describe, expect, it } from 'vitest';
import { discoveryTimeline, regionDiscoveryShares, sessionAnalytics, summarizeSessionRegions } from './session-analytics';
import type { DiscoveredSegment } from './discovery';
import type { RideSession } from './session-store';
import type { AreaRecord } from './area-types';

const session: RideSession = { id: 'ride', title: 'Ride', districtNames: [], startedAt: 1_000, endedAt: 13_000, durationSeconds: 12, distanceMeters: 100, newDistanceMeters: 20, points: [] };
const segment = (id: string, roadType: DiscoveredSegment['roadType'], discoveredAt: number, lengthMeters: number): DiscoveredSegment => ({ id, roadType, discoveredAt, lengthMeters, geometry: { type: 'LineString', coordinates: [[18.06, 59.33], [18.061, 59.331]] } });

describe('session insights', () => {
  it('uses only road discoveries on this route and inside the ride time', () => {
    const route = [segment('a', 'paved-road', 0, 10), segment('b', 'cycleway', 0, 20), segment('c', 'unpaved-path', 0, 30)];
    const discoveries = [segment('a', 'paved-road', 4_000, 10), segment('b', 'cycleway', 20_000, 20), segment('elsewhere', 'unpaved-path', 6_000, 50)];
    const result = sessionAnalytics(session, route, discoveries);
    expect(result.roadTypes).toEqual({ 'paved-road': 10, cycleway: 20, 'unpaved-path': 30 });
    expect(result.newSegments.map(item => item.id)).toEqual(['a']);
  });

  it('counts each discovered road in its API-backed local and parent areas', () => {
    const local = { area: { id: 'relation/9', name: 'Södermalms stadsdelsområde', adminLevel: 9, countryCode: 'SE', label: 'Stadsdelsområde', boundaryVersion: 'v1', geometry: null }, job: { status: 'ready', totals: { lengthMeters: 1000 } } } as AreaRecord;
    const parent = { area: { id: 'relation/7', name: 'Stockholms kommun', adminLevel: 7, countryCode: 'SE', label: 'Kommun', boundaryVersion: 'v1', geometry: null }, job: { status: 'ready', totals: { lengthMeters: 5000 } } } as AreaRecord;
    const discoveries = [segment('a', 'paved-road', 2_000, 12), segment('b', 'cycleway', 3_000, 8)];
    const regions = summarizeSessionRegions(discoveries, new Map([['a', [local, parent]], ['b', [local, parent]]]));
    expect(regions.map(region => [region.name, region.distance, region.total])).toEqual([['Södermalm', 20, 1000], ['Stockholms kommun', 20, 5000]]);
  });

  it('starts at zero and accumulates discoveries in time order', () => {
    const timeline = discoveryTimeline(session, [segment('late', 'paved-road', 12_000, 7), segment('early', 'cycleway', 2_000, 5)], 4);
    expect(timeline).toEqual([0, 5, 5, 5, 12]);
  });

  it('shows this ride within current overall region discovery', () => {
    expect(regionDiscoveryShares(20, 70, 200)).toEqual({ ride: 10, overall: 35 });
    expect(regionDiscoveryShares(20, null, 200)).toEqual({ ride: 10, overall: null });
  });
});
