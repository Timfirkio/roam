import { describe, expect, it } from 'vitest';
import { STOCKHOLM_ROAD_NETWORK } from './road-network-catalog';

describe('offline road network catalog', () => {
  it('contains the versioned five-district release', () => {
    expect(STOCKHOLM_ROAD_NETWORK.version).toBe('road-network-stockholm-2026-09-08-v1');
    expect(STOCKHOLM_ROAD_NETWORK.coverage.districtCount).toBe(5);
    expect(STOCKHOLM_ROAD_NETWORK.source.zoom).toBe(14);
    expect(STOCKHOLM_ROAD_NETWORK.source.tileCount).toBeGreaterThan(0);
  });

  it('has unique stable segment IDs and positive denominators', () => {
    const ids = STOCKHOLM_ROAD_NETWORK.segments.map(segment => segment.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => /^road-[0-9a-f]{8}:\d+$/.test(id))).toBe(true);
    for (const district of STOCKHOLM_ROAD_NETWORK.coverage.districts) {
      expect(district.denominators.segments).toBeGreaterThan(0);
      expect(district.denominators.lengthMeters).toBeGreaterThan(0);
      expect(Object.values(district.denominators.byRoadType).some(value => value.segments > 0)).toBe(true);
    }
  });

  it('keeps the catalog limited to the requested initial coverage', () => {
    expect(STOCKHOLM_ROAD_NETWORK.coverage.districts.map(district => district.name).sort()).toEqual(['ENSKEDE GÅRD', 'LILJEHOLMEN', 'STUREBY', 'SÖDERMALM', 'ÅRSTA']);
  });
});
