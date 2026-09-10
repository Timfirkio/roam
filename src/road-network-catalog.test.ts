import { describe, expect, it } from 'vitest';
import { STOCKHOLM_ROAD_NETWORK } from './road-network-catalog';

describe('offline road network catalog', () => {
  it('contains the versioned five-district release', () => {
    expect(STOCKHOLM_ROAD_NETWORK.version).toBe('road-network-stockholm-2026-09-10-v2');
    expect(STOCKHOLM_ROAD_NETWORK.coverage.districtCount).toBe(117);
    expect(STOCKHOLM_ROAD_NETWORK.source.zoom).toBe(14);
    expect(STOCKHOLM_ROAD_NETWORK.source.tileCount).toBeGreaterThan(0);
  });

  it('has no embedded geometry and positive denominators', () => {
    expect('segments' in STOCKHOLM_ROAD_NETWORK).toBe(false);
    for (const district of STOCKHOLM_ROAD_NETWORK.coverage.districts) {
      expect(district.denominators.segments).toBeGreaterThan(0);
      expect(district.denominators.lengthMeters).toBeGreaterThan(0);
      expect(Object.values(district.denominators.byRoadType).some(value => value.segments > 0)).toBe(true);
    }
  });

  it('covers the complete Stockholm district boundary catalog', () => {
    expect(STOCKHOLM_ROAD_NETWORK.coverage.districts).toHaveLength(117);
    expect(STOCKHOLM_ROAD_NETWORK.coverage.districts.some(district => district.name === 'SÖDERMALM')).toBe(true);
  });
});
