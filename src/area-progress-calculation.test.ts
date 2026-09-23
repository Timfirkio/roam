import { describe, expect, it } from 'vitest';
import { exploredTotalsKey, previousExploredAreaTotals, rememberExploredAreaTotals } from './area-progress-calculation';
import type { AreaGeometry } from './area-types';
import type { DiscoveredSegment } from './discovery';

const geometry: AreaGeometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const segment = (id: string, coordinates: [number, number][]): DiscoveredSegment => ({
  id, roadType: 'cycleway', geometry: { type: 'LineString', coordinates }, lengthMeters: 100, discoveredAt: 1,
});

describe('area progress cache keys', () => {
  it('ignores new discoveries outside the area and changes for nearby discoveries', () => {
    const near = segment('near', [[0.2, 0.2], [0.3, 0.3]]);
    const far = segment('far', [[2, 2], [3, 3]]);
    const key = exploredTotalsKey([near], 'area:boundary', geometry);
    expect(exploredTotalsKey([near, far], 'area:boundary', geometry)).toBe(key);
    expect(exploredTotalsKey([near, segment('new', [[0.4, 0.4], [0.5, 0.5]])], 'area:boundary', geometry)).not.toBe(key);
  });
  it('keeps a previous area total only while its measured discoveries remain present', () => {
    const near = segment('near', [[0.2, 0.2], [0.3, 0.3]]);
    const newer = segment('newer', [[0.4, 0.4], [0.5, 0.5]]);
    const totals = { lengthMeters: 100, byRoadType: { 'paved-road': 0, cycleway: 100, 'unpaved-path': 0 } };
    rememberExploredAreaTotals('area:boundary', [near], geometry, totals);
    expect(previousExploredAreaTotals('area:boundary', [near, newer], geometry)).toBe(totals);
    expect(previousExploredAreaTotals('area:boundary', [newer], geometry)).toBeUndefined();
    expect(previousExploredAreaTotals('other:boundary', [near], geometry)).toBeUndefined();
  });
});
