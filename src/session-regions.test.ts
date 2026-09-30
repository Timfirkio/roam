import { describe, expect, it, vi } from 'vitest';
import type { DiscoveredSegment } from './discovery';

const { lookupAreas } = vi.hoisted(() => ({ lookupAreas: vi.fn() }));
vi.mock('./area-client', () => ({ lookupAreas }));

const segment = (id: string, lng: number): DiscoveredSegment => ({
  id, roadType: 'paved-road', discoveredAt: 1, lengthMeters: 12,
  geometry: { type: 'LineString', coordinates: [[lng, 59.33], [lng + 0.0001, 59.33]] },
});

describe('session API region lookup', () => {
  it('uses returned enclosing area records for each sampled route stretch', async () => {
    const { lookupSessionRegions } = await import('./session-regions');
    lookupAreas.mockImplementation(async (lng: number) => ({ areas: [{ area: { id: lng < 18.1 ? 'local-a' : 'local-b' } }, { area: { id: 'parent' } }] }));
    const result = await lookupSessionRegions([segment('a', 18), segment('b', 18.2)]);
    expect([...result.areasBySegment.values()].map(areas => areas.map(area => area.area.id))).toEqual([['local-a', 'parent'], ['local-b', 'parent']]);
    expect(result.failed).toBe(0);
  });
});
