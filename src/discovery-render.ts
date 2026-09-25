import type { DiscoveredSegment, RoadType } from './discovery';

type Coordinates = [number, number][];
type RenderedLine = { type: 'Feature'; properties: { roadType: RoadType }; geometry: { type: 'LineString'; coordinates: Coordinates } };

function chunkIdentity(id: string) {
  const separator = id.lastIndexOf(':');
  if (separator < 0) return null;
  const index = Number(id.slice(separator + 1));
  return Number.isInteger(index) && index >= 0 ? { roadId: id.slice(0, separator), index } : null;
}

function endpointsMeet(left: [number, number], right: [number, number]) {
  const latitudeRadians = (left[1] + right[1]) / 2 * Math.PI / 180;
  const eastMeters = (left[0] - right[0]) * 111_320 * Math.cos(latitudeRadians);
  const northMeters = (left[1] - right[1]) * 111_320;
  return Math.hypot(eastMeters, northMeters) < 1;
}

/** Join adjacent saved discovery chunks for drawing, without changing coverage records. */
export function discoveredNetworkFeatures(segments: DiscoveredSegment[]): { type: 'FeatureCollection'; features: RenderedLine[] } {
  const features: RenderedLine[] = [];
  const unpavedByRoad = new Map<string, { index: number; coordinates: Coordinates }[]>();

  for (const segment of segments) {
    const coordinates = segment.geometry.coordinates;
    if (coordinates.length < 2) continue;
    const identity = segment.roadType === 'unpaved-path' ? chunkIdentity(segment.id) : null;
    if (!identity) {
      features.push({ type: 'Feature', properties: { roadType: segment.roadType }, geometry: { type: 'LineString', coordinates } });
      continue;
    }
    const chunks = unpavedByRoad.get(identity.roadId) ?? [];
    chunks.push({ index: identity.index, coordinates });
    unpavedByRoad.set(identity.roadId, chunks);
  }

  for (const chunks of unpavedByRoad.values()) {
    chunks.sort((a, b) => a.index - b.index);
    let run: Coordinates = [];
    let previousIndex = -2;
    const flush = () => {
      if (run.length > 1) features.push({ type: 'Feature', properties: { roadType: 'unpaved-path' }, geometry: { type: 'LineString', coordinates: run } });
    };
    for (const chunk of chunks) {
      const joins = chunk.index === previousIndex + 1 && run.length > 0 && endpointsMeet(run.at(-1)!, chunk.coordinates[0]);
      if (joins) run.push(...chunk.coordinates.slice(1));
      else { flush(); run = [...chunk.coordinates]; }
      previousIndex = chunk.index;
    }
    flush();
  }
  return { type: 'FeatureCollection', features };
}
