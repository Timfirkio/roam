import { areaDiscoverySignature, createExploredAreaAccumulator } from './area-geometry';
import type { AreaGeometry } from './area-types';
import type { DiscoveredSegment } from './discovery';

type ProgressRequest = {
  id: number;
  areaKey: string;
  discoveries: DiscoveredSegment[];
  geometry: AreaGeometry;
};

const MAX_CACHED_AREAS = 12;
const areas = new Map<string, { accumulator: ReturnType<typeof createExploredAreaAccumulator>; signatures: Map<string, string> }>();

self.addEventListener('message', ({ data }: MessageEvent<ProgressRequest>) => {
  try {
    const signatures = new Map(data.discoveries.map(segment => [segment.id, areaDiscoverySignature(segment)]));
    let state = areas.get(data.areaKey);
    if (!state || [...state.signatures].some(([id, value]) => signatures.get(id) !== value)) {
      state = { accumulator: createExploredAreaAccumulator(data.geometry), signatures: new Map() };
    }
    const added = data.discoveries.filter(segment => !state.signatures.has(segment.id));
    state.accumulator.add(added);
    state.signatures = signatures;
    areas.delete(data.areaKey);
    areas.set(data.areaKey, state);
    if (areas.size > MAX_CACHED_AREAS) areas.delete(areas.keys().next().value!);
    self.postMessage({ id: data.id, totals: state.accumulator.totals() });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Could not calculate area progress.' });
  }
});
