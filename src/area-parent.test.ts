import { describe, expect, it } from 'vitest';
import { containingAreaName } from './area-parent';
import type { AreaRecord } from './area-types';

const record = (name: string, adminLevel: number): AreaRecord => ({
  area: { id: name, name, adminLevel, countryCode: 'SE', label: '', boundaryVersion: 'v1', geometry: null },
  job: null,
  automatic: false,
});

describe('containingAreaName', () => {
  it('chooses the closest containing region', () => {
    expect(containingAreaName(record('Stockholms kommun', 7).area, [record('Sweden', 2), record('Stockholms län', 4), record('Stockholms kommun', 7)])).toBe('Stockholms län');
  });

  it('includes the country and Earth in the hierarchy', () => {
    expect(containingAreaName(record('Stockholms län', 4).area, [record('Sweden', 2), record('Stockholms län', 4)])).toBe('Sweden');
    expect(containingAreaName(record('Sweden', 2).area, [record('Sweden', 2)])).toBe('Earth');
  });

  it('falls back to the country when its boundary is absent from lookup', () => {
    expect(containingAreaName(record('Stockholms län', 4).area, [])).toBe('Sweden');
  });
});
