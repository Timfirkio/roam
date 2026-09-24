import { describe, expect, it, vi } from 'vitest';
import { exploredTotalsKey, latestExploredAreaTotals, previousExploredAreaTotals, rememberExploredAreaTotals } from './area-progress-calculation';
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
    expect(exploredTotalsKey([segment('new', [[0.4, 0.4], [0.5, 0.5]]), near], 'area:boundary', geometry)).toBe(exploredTotalsKey([near, segment('new', [[0.4, 0.4], [0.5, 0.5]])], 'area:boundary', geometry));
    expect(exploredTotalsKey([near, segment('new', [[0.4, 0.4], [0.5, 0.5]])], 'area:boundary', geometry)).not.toBe(key);
    expect(exploredTotalsKey([segment('near', [[0.2, 0.2], [0.4, 0.4]])], 'area:boundary', geometry)).not.toBe(key);
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
  it('restores unchanged area totals from browser storage after a reload', async () => {
    const entries = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
      removeItem: (key: string) => { entries.delete(key); },
    });
    try {
      const key = exploredTotalsKey([], 'saved:boundary', geometry);
      const first = await import('./area-progress-calculation');
      expect((await first.calculateExploredAreaTotals([], geometry, key, 'saved:boundary')).lengthMeters).toBe(0);
      expect(entries.has('roam.area-progress.current.saved:boundary')).toBe(true);
      vi.resetModules();
      const reloaded = await import('./area-progress-calculation');
      expect(reloaded.cachedExploredTotals(key, 'saved:boundary')?.lengthMeters).toBe(0);
      expect(latestExploredAreaTotals('saved:boundary')?.lengthMeters).toBe(0);
      expect(latestExploredAreaTotals('other:boundary')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
