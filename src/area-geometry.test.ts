import { describe, expect, it } from 'vitest';
import { clipLineToArea, discoveriesNearArea, exploredAreaTotals, uniqueLineMeters } from './area-geometry';
import { administrativeLabel, type AreaGeometry, type Position } from './area-types';

const square: Position[] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
const geometry: AreaGeometry = { type: 'Polygon', coordinates: [square] };

describe('boundary coverage', () => {
  it('skips distant discoveries while retaining roads that cross the area', () => {
    const segments = [
      { id: 'far', roadType: 'cycleway' as const, geometry: { type: 'LineString' as const, coordinates: [[2, 2], [3, 3]] as Position[] } },
      { id: 'crossing', roadType: 'cycleway' as const, geometry: { type: 'LineString' as const, coordinates: [[-1, 0.5], [2, 0.5]] as Position[] } },
    ];
    expect(discoveriesNearArea(segments, geometry).map(segment => segment.id)).toEqual(['crossing']);
  });
  it('counts only the road portion inside a boundary', () => {
    expect(clipLineToArea([[-1, 0.5], [2, 0.5]], geometry)).toEqual([[[0, 0.5], [1, 0.5]]]);
  });
  it('excludes holes and retains disconnected islands', () => {
    const hole: Position[] = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]];
    const island: Position[] = square.map(([x, y]) => [x + 2, y]);
    const clipped = clipLineToArea([[-1, 0.5], [4, 0.5]], { type: 'MultiPolygon', coordinates: [[square, hole], [island]] });
    expect(clipped).toHaveLength(3);
    expect(clipped[0][1][0]).toBeCloseTo(0.4);
    expect(clipped[1][0][0]).toBeCloseTo(0.6);
    expect(clipped[2]).toEqual([[2, 0.5], [3, 0.5]]);
  });
  it('does not double count reversed, clipped or partially overlapping discoveries', () => {
    const line: Position[] = [[0, 0.5], [1, 0.5]];
    expect(uniqueLineMeters([line, [...line].reverse(), [[0.2, 0.5], [0.7, 0.5]]])).toBeCloseTo(uniqueLineMeters([line]), 5);
    const discoveries = [line, [...line].reverse()].map((coordinates, i) => ({ id: `old-${i}`, roadType: 'cycleway' as const, geometry: { type: 'LineString' as const, coordinates } }));
    expect(exploredAreaTotals(discoveries, geometry).lengthMeters).toBeCloseTo(uniqueLineMeters([line]), 5);
  });
  it('includes border roads and keeps nearby parallel paths separate', () => {
    expect(clipLineToArea([[0, 0], [1, 0]], geometry)).toHaveLength(1);
    const a: Position[] = [[0, 0.5], [1, 0.5]], b: Position[] = [[0, 0.5001], [1, 0.5001]];
    expect(uniqueLineMeters([a, b])).toBeGreaterThan(uniqueLineMeters([a]) * 1.99);
  });
  it('does not require a district assignment for old imported discoveries', () => {
    const totals = exploredAreaTotals([{ id: 'legacy', roadType: 'paved-road', geometry: { type: 'LineString', coordinates: [[-1, 0.5], [0.5, 0.5]] } }], geometry);
    expect(totals.lengthMeters).toBeGreaterThan(55_000);
    expect(totals.lengthMeters).toBeLessThan(56_000);
  });
  it('uses country-specific labels and preserves unknown levels', () => {
    expect(administrativeLabel('SE', 7)).toBe('Kommun');
    expect(administrativeLabel('US', 6)).toBe('County');
    expect(administrativeLabel('XX', 6)).toBe('Administrative area · level 6');
  });
});
