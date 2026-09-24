import { lookupAreas } from './area-client';
import type { RideSession, SessionPoint } from './session-store';
import { STOCKHOLM_DISTRICTS } from './stockholm-catalog';
import { shortRegionName } from './area-display-name';

export const SESSION_NAMING_VERSION = 'area-regions-v2';
const legacyDistrictNames = new Set(STOCKHOLM_DISTRICTS.map(district => formatSessionTitle(district.name)));

export function formatSessionTitle(title: string) {
  if (title !== title.toLocaleUpperCase('sv-SE')) return title;
  return title.toLocaleLowerCase('sv-SE').replace(/(^|[\s·-])([\p{L}])/gu, (_, prefix: string, character: string) => `${prefix}${character.toLocaleUpperCase('sv-SE')}`);
}

export function isGeneratedSessionTitle(session: RideSession) {
  const previousNames = session.districtNames ?? [];
  const displayTitle = formatSessionTitle(session.title);
  if (displayTitle === (previousNames.length ? previousNames.map(formatSessionTitle).join(' · ') : 'Roam ride')) return true;
  if (previousNames.length && displayTitle === titleForRegions(previousNames)) return true;
  // Earlier saved rides can have the generated title without districtNames.
  return previousNames.length === 0 && displayTitle.split(' · ').every(name => legacyDistrictNames.has(name));
}

function routeSamples(points: SessionPoint[]) {
  if (!points.length) return [];
  const samples: SessionPoint[] = [];
  const count = Math.min(7, points.length);
  for (let index = 0; index < count; index++) {
    const point = points[Math.round(index * (points.length - 1) / Math.max(1, count - 1))]!;
    if (!samples.some(sample => sample.lng === point.lng && sample.lat === point.lat)) samples.push(point);
  }
  return samples;
}

export async function regionNamesForSession(points: SessionPoint[], lookup: typeof lookupAreas = lookupAreas) {
  const names: string[] = [];
  const matches = await Promise.all(routeSamples(points).map(point => lookup(point.lng, point.lat)));
  for (const { areas } of matches) {
    // Use the same administrative levels and preference as the map's current area.
    const region = areas.filter(record => record.area.adminLevel >= 7 && record.area.adminLevel <= 9)
      .sort((left, right) => right.area.adminLevel - left.area.adminLevel)[0]?.area.name;
    if (region && !names.includes(region)) names.push(region);
    if (names.length === 5) break;
  }
  return names;
}

export function titleForRegions(names: string[], fallback = 'Roam ride') {
  return names.length ? names.map(shortRegionName).join(' · ') : fallback;
}
