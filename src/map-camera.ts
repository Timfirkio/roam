import type { EaseToOptions, Map } from 'maplibre-gl';

type Camera = Pick<Map, 'getZoom' | 'getMinZoom' | 'getMaxZoom' | 'easeTo'>;
const zoomSteps = new WeakMap<Camera, { zoom: number; endsAt: number }>();

export function clearZoomStep(map: Camera) {
  zoomSteps.delete(map);
}

// Keep GPS and compass movements headed toward the button's zoom target.
// Preserve its deadline too, so frequent sensor updates cannot prolong it.
export function easeMapCamera(map: Camera, options: EaseToOptions) {
  const step = zoomSteps.get(map);
  if (step && Math.abs(map.getZoom() - step.zoom) > 0.000001) {
    map.easeTo({ ...options, zoom: step.zoom, duration: Math.max(0, step.endsAt - performance.now()) });
  } else {
    clearZoomStep(map);
    map.easeTo(options);
  }
}

export function stepMapZoom(map: Camera, direction: 1 | -1, options: EaseToOptions = {}) {
  const previous = zoomSteps.get(map);
  const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), (previous?.zoom ?? map.getZoom()) + direction * 0.5));
  zoomSteps.set(map, { zoom, endsAt: performance.now() + 350 });
  easeMapCamera(map, { ...options, zoom, duration: 350 });
}
