import { describe, expect, it } from 'vitest';
import { areaAtBoundaryLevel, boundaryPaintAtZoom, boundaryMatchesLevel, boundaryPreviewOpacity, mapBoundaryLevel, maxZoomForBoundaryLevel } from './map-boundary-level';
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
  it('keeps close boundaries visible and makes overview boundaries stronger', () => {
    for (const level of [2, 4, 7, 9] as const) {
      const overview = boundaryPaintAtZoom(level, level === 2 ? 4 : level === 4 ? 7 : level === 7 ? 8.5 : 10);
      const close = boundaryPaintAtZoom(level, 18);
      expect(close.opacity).toBeGreaterThan(0);
      expect(overview.opacity).toBeGreaterThan(close.opacity);
      expect(close.width).toBeGreaterThan(overview.width);
    }
  });
  it('produces continuous scalar paint through tile zoom thresholds', () => {
    for (const level of [2, 4, 7, 9] as const) {
      for (const zoom of [8, 10, 12, 14, 16, 18]) {
        const before = boundaryPaintAtZoom(level, zoom - 0.001);
        const after = boundaryPaintAtZoom(level, zoom + 0.001);
        expect(Math.abs(after.opacity - before.opacity)).toBeLessThan(0.002);
        expect(Math.abs(after.width - before.width)).toBeLessThan(0.002);
      }
    }
    expect(boundaryPaintAtZoom(9, 30)).toEqual({ opacity: 0.42, width: 1.5 });
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
