import { describe, expect, it } from 'vitest';
import { isDiscoverableProperties, legacyRoadTypeForProperties, roadTypeForProperties, stableRoadCandidateId } from './road-rules';

describe('road progress categories', () => {
  it('puts paved cycleways in the teal category', () => {
    expect(roadTypeForProperties({ class: 'cycleway', surface: 'asphalt' })).toBe('cycleway');
  });

  it('puts unpaved paths and cycleways in the orange category', () => {
    expect(roadTypeForProperties({ class: 'cycleway', surface: 'gravel' })).toBe('unpaved-path');
    expect(roadTypeForProperties({ class: 'path', surface: 'ground' })).toBe('unpaved-path');
  });

  it('folds paved bike-friendly paths into the teal cycleway network', () => {
    expect(roadTypeForProperties({ class: 'footway', bicycle: 'designated', surface: 'paved' })).toBe('cycleway');
  });

  it('discovers vector-tile cycleways encoded as paths without access tags', () => {
    expect(isDiscoverableProperties({ class: 'path', subclass: 'cycleway', surface: 'paved' })).toBe(true);
    expect(isDiscoverableProperties({ class: 'path', subclass: 'cycleway', bicycle: 'no', surface: 'paved' })).toBe(false);
  });

  it('keeps the prior IDs for reclassified paths', () => {
    const properties = { class: 'cycleway', surface: 'gravel' };
    const coordinates: [number, number][] = [[18.06, 59.33], [18.07, 59.34]];
    expect(stableRoadCandidateId(coordinates, roadTypeForProperties(properties), legacyRoadTypeForProperties(properties)))
      .toBe(stableRoadCandidateId(coordinates, 'cycleway'));
  });
});
