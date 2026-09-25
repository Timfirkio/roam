import { describe, expect, it } from 'vitest';
import { areaAtBoundaryLevel, boundaryLineOpacity, boundaryMatchesLevel, boundaryPreviewOpacity, mapBoundaryLevel, maxZoomForBoundaryLevel } from './map-boundary-level';
import type { AreaRecord } from './area-types';

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
  it('switches county and municipality outlines at the same threshold', () => {
    expect(boundaryLineOpacity(4)).toEqual(['step', ['zoom'], 0, 5, 0.9, 8, 0]);
    expect(boundaryLineOpacity(7)).toEqual(['step', ['zoom'], 0, 8, 0.9, 10, 0]);
  });
  it('fades municipal-region outlines in before the Progress cutoff', () => {
    expect(boundaryPreviewOpacity(9, 11, 13)).toEqual(['interpolate', ['linear'], ['zoom'], 11, 0.9, 13, 0]);
    expect(boundaryPreviewOpacity(7, 11, 13)).toBe(0);
  });
  it('uses the visible tier for the card and falls back to a parent when level 9 is absent', () => {
    const records = [2, 4, 7, 9].map(adminLevel => ({ area: { id: String(adminLevel), adminLevel } })) as AreaRecord[];
    expect(areaAtBoundaryLevel(records, mapBoundaryLevel(15))?.area.id).toBe('9');
    expect(areaAtBoundaryLevel(records, mapBoundaryLevel(9))?.area.id).toBe('7');
    expect(areaAtBoundaryLevel(records, mapBoundaryLevel(7))?.area.id).toBe('4');
    expect(areaAtBoundaryLevel(records.filter(record => record.area.adminLevel !== 9), 9)?.area.id).toBe('7');
  });
  it('fits a selected region within its visible zoom band', () => {
    for (const level of [2, 4, 7]) expect(mapBoundaryLevel(maxZoomForBoundaryLevel(level))).toBe(level);
  });
});
