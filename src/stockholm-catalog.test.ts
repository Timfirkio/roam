import { describe, expect, it } from 'vitest';
import { findStockholmDistrict, STOCKHOLM_CATALOG_VERSION, STOCKHOLM_DISTRICTS } from './stockholm-catalog';

describe('Stockholm district catalog', () => {
  it('contains every official Stockholm stadsdel in the source release', () => {
    expect(STOCKHOLM_CATALOG_VERSION).toBe('stockholm-stadsdelar-2021-04-13');
    expect(STOCKHOLM_DISTRICTS).toHaveLength(117);
  });
  it('includes the initial discovery districts', () => {
    const names = new Set(STOCKHOLM_DISTRICTS.map(district => district.name));
    ['LILJEHOLMEN', 'ÅRSTA', 'STUREBY', 'SÖDERMALM', 'ENSKEDE GÅRD'].forEach(name => expect(names.has(name)).toBe(true));
  });
  it('assigns a known point in Liljeholmen to the correct catalog district', () => {
    expect(findStockholmDistrict([18.0251, 59.3096])?.name).toBe('LILJEHOLMEN');
  });
});
