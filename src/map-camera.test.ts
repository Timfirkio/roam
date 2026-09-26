import { afterEach, expect, it, vi } from 'vitest';
import { clearZoomStep, easeMapCamera, stepMapZoom } from './map-camera';

function camera(zoom = 15) {
  return { getZoom: () => zoom, getMinZoom: () => 0, getMaxZoom: () => 20, easeTo: vi.fn() };
}

afterEach(() => vi.restoreAllMocks());

it('keeps the full zoom step and original deadline through GPS and heading updates', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const map = camera();
  stepMapZoom(map, 1);
  clock.mockReturnValue(100);
  easeMapCamera(map, { center: [18, 59], duration: 850 });
  expect(map.easeTo).toHaveBeenLastCalledWith({ center: [18, 59], zoom: 15.5, duration: 250 });
  clock.mockReturnValue(300);
  easeMapCamera(map, { bearing: 90, duration: 180 });
  expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 90, zoom: 15.5, duration: 50 });
});

it('accumulates rapid clicks from their targets and supports reversing direction', () => {
  const map = camera();
  stepMapZoom(map, 1);
  stepMapZoom(map, 1);
  expect(map.easeTo.mock.lastCall?.[0].zoom).toBe(16);
  stepMapZoom(map, -1);
  expect(map.easeTo.mock.lastCall?.[0].zoom).toBe(15.5);
});

it('releases the target after arrival or a manual zoom gesture', () => {
  const map = camera();
  stepMapZoom(map, 1);
  map.getZoom = () => 15.5;
  easeMapCamera(map, { bearing: 45 });
  expect(map.easeTo).toHaveBeenLastCalledWith({ bearing: 45 });
  stepMapZoom(map, 1);
  clearZoomStep(map);
  easeMapCamera(map, { center: [18, 59] });
  expect(map.easeTo).toHaveBeenLastCalledWith({ center: [18, 59] });
});

it('clamps repeated clicks to the map zoom limits', () => {
  const map = camera(20);
  stepMapZoom(map, 1);
  expect(map.easeTo.mock.lastCall?.[0].zoom).toBe(20);
  const minimum = camera(0);
  stepMapZoom(minimum, -1);
  expect(minimum.easeTo.mock.lastCall?.[0].zoom).toBe(0);
});
