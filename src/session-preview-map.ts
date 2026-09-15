import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { STOCKHOLM_ROAD_NETWORK } from './road-network-catalog';

const PREVIEW_ZOOM = STOCKHOLM_ROAD_NETWORK.source.zoom;
const tileCache = new Map<string, PreviewMapRoad[]>();

export type PreviewMapRoad = {
  coordinates: [number, number][];
  kind: 'major' | 'minor' | 'path';
};

function tileFor(lng: number, lat: number): [number, number] {
  const scale = 2 ** PREVIEW_ZOOM;
  return [
    Math.floor((lng + 180) / 360 * scale),
    Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * scale),
  ];
}

function kindForRoad(properties: Record<string, unknown>): PreviewMapRoad['kind'] {
  const roadClass = String(properties.class ?? '');
  if (['motorway', 'trunk', 'primary', 'secondary'].includes(roadClass)) return 'major';
  if (['path', 'footway', 'cycleway', 'track', 'pedestrian'].includes(roadClass)) return 'path';
  return 'minor';
}

async function roadsForTile(x: number, y: number): Promise<PreviewMapRoad[]> {
  const key = `${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;
  const url = STOCKHOLM_ROAD_NETWORK.source.tileTemplate
    .replace('{z}', String(PREVIEW_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Could not load preview map tile ${key}`);
  const layer = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer()))).layers.transportation;
  const roads: PreviewMapRoad[] = [];
  for (let index = 0; index < (layer?.length ?? 0); index++) {
    const feature = layer!.feature(index);
    const geometry = feature.toGeoJSON(x, y, PREVIEW_ZOOM).geometry;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const coordinates of lines as [number, number][][]) {
      if (coordinates.length > 1) roads.push({ coordinates, kind: kindForRoad(feature.properties ?? {}) });
    }
  }
  tileCache.set(key, roads);
  while (tileCache.size > 128) tileCache.delete(tileCache.keys().next().value!);
  return roads;
}

export async function loadSessionPreviewRoads(coordinates: [number, number][]): Promise<PreviewMapRoad[]> {
  if (coordinates.length < 2) return [];
  const tiles = new Map<string, [number, number]>();
  for (const [lng, lat] of coordinates) {
    const [x, y] = tileFor(lng, lat);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) tiles.set(`${x + dx}/${y + dy}`, [x + dx, y + dy]);
  }
  const requestedTiles = [...tiles.values()].slice(0, 64);
  return (await Promise.all(requestedTiles.map(([x, y]) => roadsForTile(x, y).catch(() => [])))).flat();
}
