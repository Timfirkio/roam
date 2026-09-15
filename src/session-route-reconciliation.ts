import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { discoverRouteSegments, type DiscoveredSegment, type GpsSample, type RoadCandidate } from './discovery';
import { STOCKHOLM_ROAD_NETWORK } from './road-network-catalog';
import { isDiscoverableProperties, legacyRoadTypeForProperties, roadTypeForProperties, stableRoadCandidateId } from './road-rules';

const DETAIL_ZOOM = STOCKHOLM_ROAD_NETWORK.source.zoom;
const TILE_NEIGHBORHOOD = [-1, 0, 1];
const tileCache = new Map<string, RoadCandidate[]>();

function tileFor(lng: number, lat: number): [number, number] {
  const scale = 2 ** DETAIL_ZOOM;
  return [
    Math.floor((lng + 180) / 360 * scale),
    Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale),
  ];
}

function candidateKey(candidate: RoadCandidate) {
  return `${candidate.id}:${candidate.geometry.coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')}`;
}

async function candidatesForTile(x: number, y: number): Promise<RoadCandidate[]> {
  const key = `${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const template = STOCKHOLM_ROAD_NETWORK.source.tileTemplate;
  const response = await fetch(template.replace('{z}', String(DETAIL_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y)), { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Could not load road-network tile ${key}`);
  const layer = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer()))).layers.transportation;
  const candidates: RoadCandidate[] = [];
  for (let index = 0; index < (layer?.length ?? 0); index++) {
    const feature = layer!.feature(index);
    const properties = feature.properties ?? {};
    if (!isDiscoverableProperties(properties)) continue;
    const geometry = feature.toGeoJSON(x, y, DETAIL_ZOOM).geometry;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    const roadType = roadTypeForProperties(properties);
    for (const coordinates of lines as [number, number][][]) {
      if (coordinates.length > 1) candidates.push({ id: stableRoadCandidateId(coordinates, roadType, legacyRoadTypeForProperties(properties)), roadType, geometry: { type: 'LineString', coordinates } });
    }
  }
  tileCache.set(key, candidates);
  while (tileCache.size > 128) tileCache.delete(tileCache.keys().next().value!);
  return candidates;
}

export async function reconcileSessionRoute(points: GpsSample[], knownIds: ReadonlySet<string>): Promise<DiscoveredSegment[]> {
  const tiles = new Map<string, [number, number]>();
  for (const point of points) {
    if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue;
    const [x, y] = tileFor(point.lng, point.lat);
    for (const dx of TILE_NEIGHBORHOOD) for (const dy of TILE_NEIGHBORHOOD) tiles.set(`${x + dx}/${y + dy}`, [x + dx, y + dy]);
  }
  const candidates: RoadCandidate[] = [];
  const requestedTiles = [...tiles.values()];
  // A stopped ride may span many tiles; keep the catch-up pass polite to the
  // network and battery while still completing before the session is saved.
  for (let index = 0; index < requestedTiles.length; index += 6) {
    const batch = requestedTiles.slice(index, index + 6);
    candidates.push(...(await Promise.all(batch.map(([x, y]) => candidatesForTile(x, y).catch(() => [])))).flat());
  }
  const unique = new Map<string, RoadCandidate>();
  for (const candidate of candidates) unique.set(candidateKey(candidate), candidate);
  return discoverRouteSegments(points, [...unique.values()], knownIds);
}

/** Reclassifies previously saved discoveries against the current network tags. */
export async function synchronizeDiscoveredSegmentRoadTypes(discoveries: DiscoveredSegment[]): Promise<DiscoveredSegment[]> {
  const tiles = new Map<string, [number, number]>();
  for (const segment of discoveries) {
    for (const [lng, lat] of segment.geometry.coordinates) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      const [x, y] = tileFor(lng, lat);
      tiles.set(`${x}/${y}`, [x, y]);
    }
  }
  const candidates: RoadCandidate[] = [];
  const requestedTiles = [...tiles.values()];
  for (let index = 0; index < requestedTiles.length; index += 6) {
    const batch = requestedTiles.slice(index, index + 6);
    candidates.push(...(await Promise.all(batch.map(([x, y]) => candidatesForTile(x, y)))).flat());
  }
  const roadTypeByCandidateId = new Map(candidates.map(candidate => [candidate.id, candidate.roadType]));
  return discoveries.map(segment => {
    const separator = segment.id.lastIndexOf(':');
    const roadType = separator > 0 ? roadTypeByCandidateId.get(segment.id.slice(0, separator)) : undefined;
    return roadType && roadType !== segment.roadType ? { ...segment, roadType } : segment;
  });
}
