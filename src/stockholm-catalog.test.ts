import { describe, expect, it } from 'vitest';
import { compareDistrictNames, findStockholmDistrict, STOCKHOLM_CATALOG_VERSION, STOCKHOLM_DISTRICTS } from './stockholm-catalog';
import { STOCKHOLM_REGION_BY_DISTRICT, STOCKHOLM_REGIONS } from './stockholm-hierarchy';
import { SWEDEN_MUNICIPALITIES } from './sweden-municipalities';

describe('Stockholm district catalog', () => {
  it('contains every official Stockholm stadsdel in the source release', () => {
    expect(STOCKHOLM_CATALOG_VERSION).toBe('stockholm-stadsdelar-2021-04-13');
    expect(STOCKHOLM_DISTRICTS).toHaveLength(117);
  });
  it('includes the initial discovery districts', () => {
    const names = new Set(STOCKHOLM_DISTRICTS.map(district => district.name));
    ['LILJEHOLMEN', 'ÅRSTA', 'STUREBY', 'SÖDERMALM', 'ENSKEDE GÅRD'].forEach(name => expect(names.has(name)).toBe(true));
  });
  it('sorts Swedish diacritics with their base letter while preserving display names', () => {
    expect(compareDistrictNames('ÅRSTA', 'BAGARMOSSEN')).toBeLessThan(0);
    expect(compareDistrictNames('ÖSTERMALM', 'VASASTADEN')).toBeLessThan(0);
  });
  it('assigns a known point in Liljeholmen to the correct catalog district', () => {
    expect(findStockholmDistrict([18.0251, 59.3096])?.name).toBe('LILJEHOLMEN');
  });
  it('assigns every district to one of the eleven regions', () => {
    expect(STOCKHOLM_REGIONS).toHaveLength(11);
    expect(STOCKHOLM_REGION_BY_DISTRICT.size).toBe(STOCKHOLM_DISTRICTS.length);
    expect(STOCKHOLM_REGIONS.flatMap(region => region.districts)).toHaveLength(STOCKHOLM_DISTRICTS.length);
    expect(STOCKHOLM_REGION_BY_DISTRICT.get('stockholm-hagsatra')?.name).toBe('Enskede-Årsta-Vantör');
  });
  it('provides the current list of Swedish municipalities for the selector', () => {
    expect(SWEDEN_MUNICIPALITIES).toHaveLength(290);
    expect(SWEDEN_MUNICIPALITIES).toContain('Stockholm');
  });
});
