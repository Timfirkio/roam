import { describe, expect, it } from 'vitest';
import { DISCOVERY_RADIUS_METERS, discoverRouteSegments, discoverSegments, isUsableGpsSample, routeDiscoverySamples, type RoadCandidate } from './discovery';

const sample = { lng: 18.0649, lat: 59.3326, accuracy: 8, timestamp: 1_700_000_000_000 };
const nearbyRoad: RoadCandidate = { id: 'nearby', roadType: 'paved-road', geometry: { type: 'LineString', coordinates: [[18.06455, 59.3326], [18.06525, 59.3326]] } };
const distantRoad: RoadCandidate = { id: 'distant', roadType: 'cycleway', geometry: { type: 'LineString', coordinates: [[18.06455, 59.33305], [18.06525, 59.33305]] } };

describe('road discovery', () => {
  it('uses the agreed 18 metre discovery radius', () => expect(DISCOVERY_RADIUS_METERS).toBe(18));
  it('rejects imprecise GPS readings', () => {
    expect(isUsableGpsSample({ ...sample, accuracy: 26 })).toBe(false);
    expect(discoverSegments({ ...sample, accuracy: 26 }, [nearbyRoad], new Set())).toEqual([]);
  });
  it('discovers only road chunks that touch the GPS corridor', () => {
    const discovered = discoverSegments(sample, [nearbyRoad, distantRoad], new Set());
    expect(discovered.length).toBeGreaterThan(0);
    expect(discovered.every(segment => segment.id.startsWith('nearby:'))).toBe(true);
  });
  it('does not rediscover an already persisted chunk', () => {
    const first = discoverSegments(sample, [nearbyRoad], new Set());
    expect(discoverSegments(sample, [nearbyRoad], new Set(first.map(segment => segment.id)))).toEqual([]);
  });
  it('fills a short, plausible gap between recorded fixes', () => {
    const route = [
      { ...sample, lng: 18.06455, timestamp: sample.timestamp },
      { ...sample, lng: 18.0658, timestamp: sample.timestamp + 8_000 },
    ];
    const road: RoadCandidate = { id: 'route', roadType: 'paved-road', geometry: { type: 'LineString', coordinates: [[18.0645, sample.lat], [18.06585, sample.lat]] } };
    expect(routeDiscoverySamples(route)).toHaveLength(7);
    expect(discoverRouteSegments(route, [road], new Set()).length).toBeGreaterThan(4);
  });
});
