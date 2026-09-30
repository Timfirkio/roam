import { uniqueNewSegments, type DiscoveredSegment, type RoadType } from './discovery';
import type { RideSession } from './session-store';
import type { AreaRecord } from './area-types';
import { displayAreaName } from './area-display-name';

export const ROAD_TYPES: { type: RoadType; label: string }[] = [
  { type: 'paved-road', label: 'Road' },
  { type: 'cycleway', label: 'Paved cycleway' },
  { type: 'unpaved-path', label: 'Unpaved path' },
];

export function routeMatchedNewSegments(discoveries: DiscoveredSegment[], routeIds: ReadonlySet<string>, startedAt: number, endedAt = Infinity) {
  return uniqueNewSegments(discoveries.filter(segment => routeIds.has(segment.id) && segment.discoveredAt >= startedAt && segment.discoveredAt <= endedAt), new Set());
}

export function sessionAnalytics(session: RideSession, routeSegments: DiscoveredSegment[], discoveries: DiscoveredSegment[]) {
  const routeIds = new Set(routeSegments.map(segment => segment.id));
  const newSegments = routeMatchedNewSegments(discoveries, routeIds, session.startedAt, session.endedAt);
  const roadTypes: Record<RoadType, number> = { 'paved-road': 0, cycleway: 0, 'unpaved-path': 0 };
  for (const segment of uniqueNewSegments(routeSegments, new Set())) roadTypes[segment.roadType] += segment.lengthMeters;
  return {
    roadTypes,
    newSegments: [...newSegments].sort((a, b) => a.discoveredAt - b.discoveredAt),
    newDistanceMeters: newSegments.reduce((total, segment) => total + segment.lengthMeters, 0),
  };
}

export function summarizeSessionRegions(segments: DiscoveredSegment[], areasBySegment: ReadonlyMap<string, AreaRecord[]>) {
  const regions = new Map<string, { id: string; name: string; label: string; level: number; distance: number; total: number | null }>();
  for (const segment of segments) {
    for (const record of areasBySegment.get(segment.id) ?? []) {
      const { area, job } = record;
      // Country-scale network totals are often unavailable. Include the
      // enclosing county/municipality and every finer API-backed area.
      if (area.adminLevel < 4) continue;
      const entry = regions.get(area.id) ?? {
        id: area.id, name: displayAreaName(area.name, area.adminLevel), label: area.label,
        level: area.adminLevel, distance: 0,
        total: job?.status === 'ready' && job.totals?.lengthMeters ? job.totals.lengthMeters : null,
      };
      entry.distance += segment.lengthMeters;
      regions.set(area.id, entry);
    }
  }
  return [...regions.values()].sort((a, b) => b.level - a.level || b.distance - a.distance || a.name.localeCompare(b.name));
}

export function regionDiscoveryShares(rideMeters: number, overallMeters: number | null, totalMeters: number | null) {
  if (!totalMeters || totalMeters <= 0) return null;
  const ride = Math.min(100, Math.max(0, rideMeters / totalMeters * 100));
  const overall = overallMeters === null ? null : Math.min(100, Math.max(ride, overallMeters / totalMeters * 100));
  return { ride, overall };
}

export function discoveryTimeline(session: RideSession, segments: DiscoveredSegment[], steps = 12) {
  const duration = Math.max(1, session.endedAt - session.startedAt);
  const buckets = Array.from({ length: steps + 1 }, () => 0);
  for (const segment of segments) {
    const index = Math.min(steps, Math.max(1, Math.ceil((segment.discoveredAt - session.startedAt) / duration * steps)));
    buckets[index] += segment.lengthMeters;
  }
  let sum = 0;
  return buckets.map(value => (sum += value));
}
