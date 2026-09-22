import { exploredAreaTotals } from './area-geometry';
import type { AreaDiscovery, AreaGeometry } from './area-types';

type ProgressRequest = {
  id: number;
  discoveries: AreaDiscovery[];
  geometry: AreaGeometry;
};

self.addEventListener('message', ({ data }: MessageEvent<ProgressRequest>) => {
  try {
    self.postMessage({ id: data.id, totals: exploredAreaTotals(data.discoveries, data.geometry) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'Could not calculate area progress.' });
  }
});
