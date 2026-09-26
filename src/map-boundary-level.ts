import type { AreaRecord } from './area-types';

/** Keep county, municipality, and municipal-region outlines in contiguous zoom bands. */
export function mapBoundaryLevel(zoom: number) {
  if (zoom < 5) return 2;
  if (zoom < 8) return 4;
  return zoom < 10 ? 7 : 9;
}

/** Choose the boundary tier at this zoom, falling back to the nearest available parent. */
export function areaAtBoundaryLevel(areas: AreaRecord[], level: number) {
  return [...areas]
    .filter(record => record.area.adminLevel <= level)
    .sort((left, right) => right.area.adminLevel - left.area.adminLevel)[0] ?? null;
}

/** A fitted region must stay inside the zoom band where its boundary is shown. */
export function maxZoomForBoundaryLevel(level: number) {
  if (level <= 2) return 4.95;
  if (level <= 4) return 7.95;
  if (level <= 7) return 9.95;
  return 13.5;
}

/** Level 9 can include a municipality when it has no Level 9 children. */
export function boundaryMatchesLevel(properties: Record<string, unknown>, level: number) {
  const adminLevel = Number(properties.admin_level);
  return level === 9
    ? Number(properties.display_level ?? adminLevel) === 9
    : adminLevel === level;
}

/** Show only the outline tier that matches the current zoom. */
export function boundaryLineOpacity(level: 2 | 4 | 7 | 9) {
  const stops = {
    2: [0, 0.82, 4, 0.82, 6, 0.55, 9, 0.38, 14, 0.3, 20, 0.25],
    4: [0, 0.15, 5, 0.78, 7, 0.8, 9, 0.62, 12, 0.42, 16, 0.32, 20, 0.25],
    7: [0, 0.15, 7, 0.74, 8.5, 0.82, 10, 0.65, 12, 0.45, 16, 0.34, 20, 0.27],
    9: [0, 0.12, 9, 0.78, 10, 0.84, 12, 0.75, 15, 0.62, 18, 0.5, 20, 0.42],
  }[level];
  return ['interpolate', ['linear'], ['zoom'], ...stops];
}

/** Preview Level 9 outlines as discovered roads approach their overview cutoff. */
export function boundaryPreviewOpacity(level: 2 | 4 | 7 | 9, fullZoom: number, startZoom: number) {
  return level === 9 ? ['interpolate', ['linear'], ['zoom'], fullZoom, 0.9, startZoom, 0] : 0;
}
