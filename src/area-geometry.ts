import { booleanPointInPolygon, distance, lineIntersect, lineString } from '@turf/turf';
import type { AreaDiscovery, AreaGeometry, AreaTotals, Position } from './area-types';
import type { DiscoveredSegment } from './discovery';

export function areaDiscoverySignature(segment: DiscoveredSegment) {
  return `${segment.id}:${segment.roadType}:${segment.discoveredAt}:${JSON.stringify(segment.geometry.coordinates)}`;
}

export function emptyAreaTotals(): AreaTotals {
  return { lengthMeters: 0, byRoadType: { 'paved-road': 0, cycleway: 0, 'unpaved-path': 0 } };
}

export function areaBounds(geometry: AreaGeometry): [number, number, number, number] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygons) for (const ring of polygon) for (const [x, y] of ring) {
    bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
  }
  return bounds;
}

/** Avoid sending discoveries from elsewhere in the account to the area worker. */
export function discoveriesNearArea<T extends AreaDiscovery>(discoveries: T[], geometry: AreaGeometry): T[] {
  const [west, south, east, north] = areaBounds(geometry);
  return discoveries.filter(segment => {
    const coordinates = segment.geometry.coordinates;
    if (coordinates.length < 2) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of coordinates) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    return maxX >= west && minX <= east && maxY >= south && minY <= north;
  });
}

type AreaClipContext = { rings: Position[][]; polygon: AreaGeometry; bounds: [number, number, number, number] };

function areaClipContext(geometry: AreaGeometry): AreaClipContext {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return { rings: polygons.flat(), polygon: geometry, bounds: areaBounds(geometry) };
}

/** Split at every polygon edge; midpoint tests handle holes and disconnected islands. */
function clipLineToAreaWithContext(coordinates: Position[], { rings, polygon, bounds }: AreaClipContext): Position[][] {
  const parts: Position[][] = [];
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1], b = coordinates[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], norm = dx * dx + dy * dy;
    if (!norm || Math.max(a[0], b[0]) < bounds[0] || Math.min(a[0], b[0]) > bounds[2]
      || Math.max(a[1], b[1]) < bounds[1] || Math.min(a[1], b[1]) > bounds[3]) continue;
    const fractions = [0, 1];
    for (const ring of rings) {
      for (const intersection of lineIntersect(lineString([a, b]), lineString(ring)).features) {
        const [x, y] = intersection.geometry.coordinates;
        fractions.push(Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / norm)));
      }
    }
    fractions.sort((left, right) => left - right);
    const at = (t: number): Position => [a[0] + t * dx, a[1] + t * dy];
    for (let j = 1; j < fractions.length; j++) {
      const lo = fractions[j - 1], hi = fractions[j];
      if (hi - lo > 1e-10 && booleanPointInPolygon(at((lo + hi) / 2), polygon)) parts.push([at(lo), at(hi)]);
    }
  }
  return parts;
}

export function clipLineToArea(coordinates: Position[], geometry: AreaGeometry): Position[][] {
  return clipLineToAreaWithContext(coordinates, areaClipContext(geometry));
}

/** Union collinear overlapping stretches, including reversed and partially clipped copies.
 * Geographic coordinates are quantized only for grouping (~centimetre tolerance),
 * never for measurement. Different parallel paths remain separate.
 */
export function uniqueLineMeters(lines: Position[][]): number {
  const groups = new Map<string, { axis: Position; normal: number; intervals: [number, number][] }>();
  for (const line of lines) for (let i = 1; i < line.length; i++) {
    let a = line[i - 1], b = line[i];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) [a, b] = [b, a];
    const dx = b[0] - a[0], dy = b[1] - a[1], size = Math.hypot(dx, dy);
    if (!size) continue;
    const axis: Position = [dx / size, dy / size];
    const normal = -axis[1] * a[0] + axis[0] * a[1];
    const key = `${Math.round(axis[0] * 1e8)}:${Math.round(axis[1] * 1e8)}:${Math.round(normal * 1e7)}`;
    const group = groups.get(key) ?? { axis, normal, intervals: [] };
    group.intervals.push([a[0] * group.axis[0] + a[1] * group.axis[1], b[0] * group.axis[0] + b[1] * group.axis[1]]);
    groups.set(key, group);
  }
  let total = 0;
  for (const { axis, normal, intervals } of groups.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    const point = (t: number): Position => [axis[0] * t - axis[1] * normal, axis[1] * t + axis[0] * normal];
    let [lo, hi] = intervals[0];
    for (const [nextLo, nextHi] of intervals.slice(1)) {
      if (nextLo <= hi + 1e-9) hi = Math.max(hi, nextHi);
      else { total += distance(point(lo), point(hi), { units: 'meters' }); lo = nextLo; hi = nextHi; }
    }
    total += distance(point(lo), point(hi), { units: 'meters' });
  }
  return total;
}

/** Retain clipped lines so new discoveries do not reclip the whole ride history. */
export function createExploredAreaAccumulator(geometry: AreaGeometry) {
  const lines: Record<string, Position[][]> = { 'paved-road': [], cycleway: [], 'unpaved-path': [] };
  const seen = new Set<string>();
  const context = areaClipContext(geometry);
  return {
    add(discoveries: AreaDiscovery[]) {
      for (const segment of discoveries) {
        if (seen.has(segment.id)) continue;
        seen.add(segment.id);
        const type = segment.roadType === 'unpaved-path' ? 'unpaved-path' : segment.roadType === 'paved-road' ? 'paved-road' : 'cycleway';
        lines[type].push(...clipLineToAreaWithContext(segment.geometry.coordinates, context));
      }
    },
    totals(): AreaTotals {
      const totals = emptyAreaTotals();
      for (const type of Object.keys(totals.byRoadType) as Array<keyof typeof totals.byRoadType>) {
        totals.byRoadType[type] = uniqueLineMeters(lines[type]);
      }
      totals.lengthMeters = uniqueLineMeters(Object.values(lines).flat());
      return totals;
    },
  };
}

export function exploredAreaTotals(discoveries: AreaDiscovery[], geometry: AreaGeometry): AreaTotals {
  const accumulator = createExploredAreaAccumulator(geometry);
  accumulator.add(discoveries);
  return accumulator.totals();
}
