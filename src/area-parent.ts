import type { AdministrativeArea, AreaRecord } from './area-types';

/** Name the closest known enclosing boundary, including country and globe. */
export function containingAreaName(area: AdministrativeArea, coveringAreas: AreaRecord[]): string {
  if (area.adminLevel <= 2) return 'Earth';

  const parent = coveringAreas
    .filter(record => record.area.adminLevel < area.adminLevel && record.area.countryCode === area.countryCode)
    .sort((left, right) => right.area.adminLevel - left.area.adminLevel)[0];
  if (parent) return parent.area.name;

  const countryCode = area.countryCode.toUpperCase();
  if (/^[A-Z]{2}$/.test(countryCode)) {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode) ?? 'Earth';
  }
  return 'Earth';
}
