import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { booleanIntersects, bboxPolygon, feature } from '@turf/turf';
import { areaBounds, clipLineToArea, emptyAreaTotals, uniqueLineMeters } from '../src/area-geometry.ts';
import { isDiscoverableProperties, roadTypeForProperties } from '../src/road-rules.ts';

export const RULES_VERSION = 'roam-area-length-v1';
export const DETAIL_ZOOM = 14;
const N = 2 ** DETAIL_ZOOM;
const latitude = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / N))) * 180 / Math.PI;
export const tileBounds = (x, y) => [x / N * 360 - 180, latitude(y + 1), (x + 1) / N * 360 - 180, latitude(y)];

export function coveringTiles(geometry, limit) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const tiles = new Map();
  for (const coordinates of polygons) {
    const polygon = { type: 'Polygon', coordinates };
    const [west, south, east, north] = areaBounds(polygon);
    if (east - west > 180 || south < -85.05112878 || north > 85.05112878) {
      throw new Error('This boundary crosses the dateline or polar map limit and needs a regional extract.');
    }
    const x = lng => Math.max(0, Math.min(N - 1, Math.floor((lng + 180) / 360 * N)));
    const y = lat => Math.max(0, Math.min(N - 1, Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * N)));
    const minX = x(west), maxX = x(east), minY = y(north), maxY = y(south);
    // Bound enumeration too: a narrow/complex polygon can have a huge bounding box.
    if ((maxX - minX + 1) * (maxY - minY + 1) > limit * 8) throw new Error('This area is too large for the current calculation limit. Choose a smaller area.');
    for (let tx = minX; tx <= maxX; tx++) for (let ty = minY; ty <= maxY; ty++) {
      if (booleanIntersects(feature(polygon), bboxPolygon(tileBounds(tx, ty)))) tiles.set(`${tx}/${ty}`, [tx, ty]);
      if (tiles.size > limit) throw new Error('This area is too large for the current calculation limit. Choose a smaller area.');
    }
  }
  return [...tiles.values()];
}

export function decodeNetworkTile(bytes, x, y) {
  const layer = new VectorTile(new PbfReader(new Uint8Array(bytes))).layers.transportation;
  const roads = [];
  for (let i = 0; i < (layer?.length ?? 0); i++) {
    const f = layer.feature(i);
    if (f.type !== 2 || !isDiscoverableProperties(f.properties)) continue;
    const geometry = f.toGeoJSON(x, y, DETAIL_ZOOM).geometry;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const coordinates of lines) roads.push({ coordinates, roadType: roadTypeForProperties(f.properties) });
  }
  return roads;
}

export function measureTile(roads, x, y, boundary) {
  const totals = emptyAreaTotals();
  const clipped = { 'paved-road': [], cycleway: [], 'unpaved-path': [] };
  const bounds = tileBounds(x, y);
  const tile = bboxPolygon(bounds).geometry;
  for (const road of roads) for (const part of clipLineToArea(road.coordinates, tile)) {
    // Half-open tile ownership: west/north owns a seam; east/south does not.
    const onEast = part.every(p => Math.abs(p[0] - bounds[2]) < 1e-10);
    const onSouth = part.every(p => Math.abs(p[1] - bounds[1]) < 1e-10);
    if ((onEast && x < N - 1) || (onSouth && y < N - 1)) continue;
    clipped[road.roadType].push(...clipLineToArea(part, boundary));
  }
  for (const type of Object.keys(clipped)) totals.byRoadType[type] = uniqueLineMeters(clipped[type]);
  totals.lengthMeters = uniqueLineMeters(Object.values(clipped).flat());
  return totals;
}
