import { expect, it } from 'vitest';
import type { Map } from 'maplibre-gl';
import { orderMapOverlays } from './map-overlay-order';

it('keeps newly added region overlays in the ground pass before buildings and the player', () => {
  const layers = ['roads', 'boundaries', 'roam-buildings-3d', 'roam-player-model', 'current-region-fill', 'current-region-line'];
  const map = {
    getLayer: (id: string) => layers.includes(id) ? { id } : undefined,
    moveLayer: (id: string) => { layers.splice(layers.indexOf(id), 1); layers.push(id); },
  } as unknown as Pick<Map, 'getLayer' | 'moveLayer'>;
  const ground = ['boundaries', 'current-region-fill', 'current-region-line'];
  orderMapOverlays(map, ground);
  const buildings = layers.indexOf('roam-buildings-3d');
  for (const id of ground) expect(layers.indexOf(id)).toBeLessThan(buildings);
  expect(layers.at(-1)).toBe('roam-player-model');
  const firstOrder = [...layers];
  orderMapOverlays(map, ground);
  expect(layers).toEqual(firstOrder);
});
