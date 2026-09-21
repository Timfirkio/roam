import type { DiscoveredSegment, RoadType } from './discovery';

export type Position = [number, number];
export type AreaGeometry = { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] };
export type AdministrativeArea = {
  id: string;
  name: string;
  adminLevel: number;
  countryCode: string;
  label: string;
  boundaryVersion: string;
  geometry: AreaGeometry | null;
};
export type AreaTotals = { lengthMeters: number; byRoadType: Record<RoadType, number> };
export type AreaJob = {
  id: string;
  areaId: string;
  boundaryVersion: string;
  networkVersion: string;
  rulesVersion: string;
  status: 'queued' | 'running' | 'ready' | 'failed';
  completedTiles: number;
  totalTiles: number;
  totals: AreaTotals | null;
  error: string | null;
  updatedAt: string;
};
export type AreaRecord = { area: AdministrativeArea; job: AreaJob | null; automatic: boolean };
export type AreaLookup = { areas: AreaRecord[]; source: string };
export type AreaDiscovery = Pick<DiscoveredSegment, 'id' | 'geometry' | 'roadType'>;

const LABELS: Record<string, Record<number, string>> = {
  SE: { 2: 'Country', 4: 'Län', 6: 'Sameby', 7: 'Kommun', 8: 'Distrikt', 9: 'Stadsdelsområde', 10: 'Stadsdel' },
  US: { 2: 'Country', 4: 'State', 6: 'County', 8: 'Municipality' },
  DE: { 2: 'Country', 4: 'Bundesland', 5: 'Regierungsbezirk', 6: 'Kreis', 8: 'Gemeinde', 9: 'Stadtbezirk', 10: 'Stadtteil' },
};

// Preserve unknown levels instead of inventing a universal six-level hierarchy.
export function administrativeLabel(countryCode: string, level: number): string {
  return LABELS[countryCode.toUpperCase()]?.[level] ?? (level === 2 ? 'Country' : `Administrative area · level ${level}`);
}
