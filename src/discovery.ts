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

/**
 * Turns a recorded route into a sequence of closely spaced samples. Background
 * GPS can legitimately skip a few fixes while Android wakes the WebView; the
 * interpolated corridor fills those short gaps without joining unrelated legs.
 */
export function routeDiscoverySamples(points: GpsSample[]): GpsSample[] {
  const usable = points.filter(isUsableGpsSample).sort((a, b) => a.timestamp - b.timestamp);
  const samples: GpsSample[] = [];
  for (let index = 0; index < usable.length; index++) {
    const current = usable[index];
    samples.push(current);
    const next = usable[index + 1];
    if (!next) continue;
    const latitudeMeters = (next.lat - current.lat) * 111_320;
    const longitudeMeters = (next.lng - current.lng) * 111_320 * Math.cos(((current.lat + next.lat) / 2) * Math.PI / 180);
    const distanceMeters = Math.hypot(latitudeMeters, longitudeMeters);
    const elapsedMilliseconds = next.timestamp - current.timestamp;
    // Do not invent a route across a genuinely long tracking outage.
    if (distanceMeters < 20 || distanceMeters > 180 || elapsedMilliseconds > 15_000) continue;
    const steps = Math.ceil(distanceMeters / 14);
    for (let step = 1; step < steps; step++) {
      const fraction = step / steps;
      samples.push({
        lng: current.lng + (next.lng - current.lng) * fraction,
        lat: current.lat + (next.lat - current.lat) * fraction,
        accuracy: Math.max(current.accuracy, next.accuracy),
        timestamp: Math.round(current.timestamp + elapsedMilliseconds * fraction),
      });
    }
  }
  return samples;
}

export function discoverRouteSegments(points: GpsSample[], candidates: RoadCandidate[], knownIds: ReadonlySet<string>): DiscoveredSegment[] {
  const found: DiscoveredSegment[] = [];
  const known = new Set(knownIds);
  for (const sample of routeDiscoverySamples(points)) {
    const latitudePadding = DISCOVERY_RADIUS_METERS / 111_320;
    const longitudePadding = DISCOVERY_RADIUS_METERS / (111_320 * Math.cos(sample.lat * Math.PI / 180));
    const nearby = candidates.filter(candidate => {
      const longitudes = candidate.geometry.coordinates.map(([lng]) => lng);
      const latitudes = candidate.geometry.coordinates.map(([, lat]) => lat);
      return Math.max(...longitudes) >= sample.lng - longitudePadding
        && Math.min(...longitudes) <= sample.lng + longitudePadding
        && Math.max(...latitudes) >= sample.lat - latitudePadding
        && Math.min(...latitudes) <= sample.lat + latitudePadding;
    });
    for (const segment of discoverSegments(sample, nearby, known)) {
      known.add(segment.id);
      found.push(segment);
    }
  }
  return found;
}
