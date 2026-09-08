import { describe, expect, it, vi } from 'vitest';
import { Marker, LngLat, type Map } from 'maplibre-gl';

// Exercise the real MapLibre marker with just the DOM/map surface it needs.
function fixture() {
  const element = {
    classList: { add() {}, remove() {} },
    style: {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    hasAttribute: () => true, setAttribute() {},
  } as unknown as HTMLElement;
  const project = vi.fn((location: LngLat) => {
    const point = { x: location.lng, y: location.lat, _add() { return this; }, round() { return this; } };
    return point;
  });
  const map = {
    getCanvasContainer: () => ({ appendChild() {} }),
    on() {}, off() {}, loaded: () => true, isMoving: () => false,
    transform: { getCoveringTilesDetailsProvider: () => ({ allowWorldCopies: () => false }) },
    project,
    _ownerWindow: { requestAnimationFrame: () => 1 },
  } as unknown as Map;
  return { marker: new Marker({ element, anchor: 'center' }), map, project };
}

describe('GPS marker initialization with MapLibre', () => {
  it('reproduces the crash when attaching before assigning a location', () => {
    const { marker, map } = fixture();
    expect(() => marker.addTo(map)).toThrow(/lng/);
  });

  it('projects the first GPS fix when coordinates are assigned before attachment', () => {
    const { marker, map, project } = fixture();
    expect(() => marker.setLngLat([18.0649, 59.3326]).addTo(map)).not.toThrow();
    expect(project.mock.calls[0][0].lng).toBeCloseTo(18.0649, 8);
    expect(project.mock.calls[0][0].lat).toBeCloseTo(59.3326, 8);
    expect(() => marker.setLngLat([18.065, 59.333])).not.toThrow();
    expect(marker.getLngLat().lng).toBeCloseTo(18.065, 8);
    expect(marker.getLngLat().lat).toBeCloseTo(59.333, 8);
  });
});
