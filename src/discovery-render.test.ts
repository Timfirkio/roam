import { describe, expect, it } from 'vitest';
import type { DiscoveredSegment } from './discovery';
import { discoveredNetworkFeatures } from './discovery-render';

const segment = (id: string, from: number, to: number, roadType: DiscoveredSegment['roadType'] = 'unpaved-path'): DiscoveredSegment => ({
  id,
  roadType,
  geometry: { type: 'LineString', coordinates: [[from, 59], [to, 59]] },
  lengthMeters: 12,
  discoveredAt: 1,
});

describe('discovered path rendering', () => {
  it('grows one line from adjacent chunks even when discoveries arrive out of order', () => {
    const { features } = discoveredNetworkFeatures([
      segment('road-a:2', 2, 3),
      segment('road-a:0', 0, 1),
      segment('road-a:1', 1, 2),
    ]);
    expect(features).toHaveLength(1);
    expect(features[0].geometry.coordinates).toEqual([[0, 59], [1, 59], [2, 59], [3, 59]]);
  });

  it('does not draw undiscovered gaps or bridge mismatched geometry', () => {
    const { features } = discoveredNetworkFeatures([
      segment('road-a:0', 0, 1),
      segment('road-a:2', 2, 3),
      segment('road-a:3', 4, 5),
      segment('road-b:0', 5, 6),
    ]);
    expect(features.map(feature => feature.geometry.coordinates)).toEqual([
      [[0, 59], [1, 59]],
      [[2, 59], [3, 59]],
      [[4, 59], [5, 59]],
      [[5, 59], [6, 59]],
    ]);
  });

  it('leaves other road categories as separate features', () => {
    const { features } = discoveredNetworkFeatures([segment('road-a:0', 0, 1, 'cycleway'), segment('road-a:1', 1, 2, 'cycleway')]);
    expect(features).toHaveLength(2);
  });
});
