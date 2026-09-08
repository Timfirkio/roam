import { buffer, booleanIntersects, lineChunk, length } from '@turf/turf';

type LineString = { type: 'LineString'; coordinates: [number, number][] };
const lineString = (coordinates: [number, number][]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } });
const point = (coordinates: [number, number]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates } });

export const DISCOVERY_RADIUS_METERS = 18;
export const MAX_GPS_ACCURACY_METERS = 25;
const DISCOVERY_CHUNK_METERS = 12;

export type RoadType = 'paved-road' | 'cycleway' | 'unpaved-path' | 'footpath';
export type GpsSample = { lng: number; lat: number; accuracy: number; timestamp: number };
export type RoadCandidate = { id: string; geometry: LineString; roadType: RoadType };
export type DiscoveredSegment = {
  id: string;
  regionId?: string;
  regionName?: string;
  roadType: RoadType;
  geometry: LineString;
  lengthMeters: number;
  discoveredAt: number;
};

export function isUsableGpsSample(sample: GpsSample) {
  return Number.isFinite(sample.lng)
    && Number.isFinite(sample.lat)
    && Number.isFinite(sample.accuracy)
    && sample.accuracy > 0
    && sample.accuracy <= MAX_GPS_ACCURACY_METERS;
}

export function discoverSegments(sample: GpsSample, candidates: RoadCandidate[], knownIds: ReadonlySet<string>, region?: { id: string; name: string }): DiscoveredSegment[] {
  if (!isUsableGpsSample(sample)) return [];
  const corridor = buffer(point([sample.lng, sample.lat]), DISCOVERY_RADIUS_METERS, { units: 'meters', steps: 16 });
  if (!corridor) return [];
  const found: DiscoveredSegment[] = [];
  for (const candidate of candidates) {
    if (candidate.geometry.coordinates.length < 2) continue;
    const chunks = lineChunk(lineString(candidate.geometry.coordinates) as any, DISCOVERY_CHUNK_METERS / 1000, { units: 'kilometers' });
    chunks.features.forEach((chunk, index) => {
      const id = `${candidate.id}:${index}`;
      if (knownIds.has(id) || !booleanIntersects(chunk, corridor)) return;
      found.push({
        id,
        regionId: region?.id,
        regionName: region?.name,
        roadType: candidate.roadType,
        geometry: chunk.geometry as unknown as LineString,
        lengthMeters: Math.round(length(chunk, { units: 'kilometers' }) * 1000),
        discoveredAt: sample.timestamp,
      });
    });
  }
  return found;
}
