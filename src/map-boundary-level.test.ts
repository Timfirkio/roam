import { describe, expect, it } from 'vitest';
import { boundaryMatchesLevel, mapBoundaryLevel } from './map-boundary-level';

describe('map boundary levels', () => {
  it('switches directly from municipality to county boundaries', () => {
    expect(mapBoundaryLevel(9.99)).toBe(7);
    expect(mapBoundaryLevel(8)).toBe(7);
    expect(mapBoundaryLevel(7.99)).toBe(4);
    expect(mapBoundaryLevel(5)).toBe(4);
    expect(mapBoundaryLevel(4.99)).toBe(2);
  });

  it('keeps promoted municipalities at both municipality and municipal-region zooms', () => {
    const municipality = { admin_level: 7, display_level: 9 };
    expect(boundaryMatchesLevel(municipality, 7)).toBe(true);
    expect(boundaryMatchesLevel(municipality, 9)).toBe(true);
    expect(boundaryMatchesLevel({ admin_level: 7, display_level: 7 }, 9)).toBe(false);
    expect(boundaryMatchesLevel({ admin_level: 9 }, 7)).toBe(false);
  });
});
