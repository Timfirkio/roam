import { VectorTile } from '@mapbox/vector-tile';
import { fromVectorTileJs, type VectorTileFeatureLike } from '@maplibre/vt-pbf';
import { PbfReader } from 'pbf';

export const NETWORK_MIN_ZOOM = 12;
export const NETWORK_DETAIL_ZOOM = 14;
const EXTENT = 8192;
type Point = ReturnType<VectorTileFeatureLike['loadGeometry']>[number][number];
export type DetailTile = { data: ArrayBuffer; dx: number; dy: number };
const detailTileCache = new Map<string, ArrayBuffer>();

// Remove child-tile buffers at internal seams so translucent lines aren't drawn twice.
function clipLine(line: Point[], bounds: number[]): Point[][] {
  const parts: Point[][] = [];
  let part: Point[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    let lo = 0, hi = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [a.x - bounds[0], bounds[2] - a.x, a.y - bounds[1], bounds[3] - a.y];
    for (let edge = 0; edge < 4; edge++) {
      if (p[edge] === 0) { if (q[edge] < 0) hi = -1; }
      else if (p[edge] < 0) lo = Math.max(lo, q[edge] / p[edge]);
      else hi = Math.min(hi, q[edge] / p[edge]);
    }
    if (lo >= hi) { part = []; continue; }
    const start = a.clone(), end = b.clone();
    start.x = a.x + lo * dx; start.y = a.y + lo * dy;
    end.x = a.x + hi * dx; end.y = a.y + hi * dy;
    const previous = part.at(-1);
    if (!previous || previous.x !== start.x || previous.y !== start.y) {
      part = [start]; parts.push(part);
    }
    part.push(end);
  }
  return parts;
}

export function mergeNetworkTiles(tiles: DetailTile[], zoom: number): ArrayBuffer {
  const scale = 2 ** (NETWORK_DETAIL_ZOOM - zoom);
  const features: VectorTileFeatureLike[] = [];
  for (const { data, dx, dy } of tiles) {
    const layer = new VectorTile(new PbfReader(new Uint8Array(data))).layers.transportation;
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      if (feature.type !== 2) continue;
      const e = feature.extent;
      const bounds = [dx === 0 ? -e : 0, dy === 0 ? -e : 0, dx === scale - 1 ? 2 * e : e, dy === scale - 1 ? 2 * e : e];
      const geometry = feature.loadGeometry().flatMap(line => clipLine(line, bounds)).map(line => line.map(point => {
        point.x = Math.round((point.x / e + dx) * EXTENT / scale);
        point.y = Math.round((point.y / e + dy) * EXTENT / scale);
        return point;
      }));
      if (geometry.length) features.push({ type: 2, id: feature.id, properties: feature.properties, extent: EXTENT, loadGeometry: () => geometry });
    }
  }
  const data = fromVectorTileJs({ layers: { transportation: {
    name: 'transportation', version: 2, extent: EXTENT, length: features.length, feature: i => features[i],
  } } });
  return Uint8Array.from(data).buffer;
}

// Reuse raw detail tiles while the app is open, across parent zoom changes and
// map remounts. HTTP cache handles persistence between app launches.
export function createNetworkTileLoader(template: string, fetchTile: typeof fetch = fetch) {
  const cache = detailTileCache;
  let active = 0;
  const queue: (() => void)[] = [];
  async function readTile(x: number, y: number, signal: AbortSignal) {
    const url = template.replace('{z}', '14').replace('{x}', String(x)).replace('{y}', String(y));
    const cached = cache.get(url);
    if (cached) { cache.delete(url); cache.set(url, cached); return cached; }
    if (active >= 6) await new Promise<void>(resolve => queue.push(resolve));
    else active++;
    try {
      signal.throwIfAborted();
      const reused = cache.get(url);
      if (reused) return reused;
      const response = await fetchTile(url, { signal, cache: 'force-cache' });
      if (!response.ok) throw new Error(`Network tile failed: ${response.status}`);
      const data = await response.arrayBuffer();
      cache.set(url, data);
      while (cache.size > 128) cache.delete(cache.keys().next().value!);
      return data;
    } finally {
      const next = queue.shift();
      if (next) next(); else active--;
    }
  }
  return async (zoom: number, x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> => {
    signal.throwIfAborted();
    if (!Number.isInteger(zoom) || zoom < NETWORK_MIN_ZOOM || zoom > NETWORK_DETAIL_ZOOM) throw new Error('Unsupported network tile zoom');
    if (zoom === NETWORK_DETAIL_ZOOM) return (await readTile(x, y, signal)).slice(0);
    const scale = 2 ** (NETWORK_DETAIL_ZOOM - zoom);
    const jobs: Promise<DetailTile>[] = [];
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      jobs.push(readTile(x * scale + dx, y * scale + dy, signal).then(data => ({ data, dx, dy })));
    }
    const tiles = await Promise.all(jobs);
    signal.throwIfAborted();
    return mergeNetworkTiles(tiles, zoom);
  };
}
