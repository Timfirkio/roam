/** Keep county, municipality, and municipal-region outlines in contiguous zoom bands. */
export function mapBoundaryLevel(zoom: number) {
  if (zoom < 5) return 2;
  if (zoom < 8) return 4;
  return zoom < 10 ? 7 : 9;
}

/** Level 9 can include a municipality when it has no Level 9 children. */
export function boundaryMatchesLevel(properties: Record<string, unknown>, level: number) {
  const adminLevel = Number(properties.admin_level);
  return level === 9
    ? Number(properties.display_level ?? adminLevel) === 9
    : adminLevel === level;
}
