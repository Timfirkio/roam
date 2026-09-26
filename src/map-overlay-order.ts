import type { Map } from 'maplibre-gl';

/** Ground layers must stay in one terrain pass, before live 3D geometry. */
export function orderMapOverlays(map: Pick<Map, 'getLayer' | 'moveLayer'>, groundLayerIds: readonly string[]) {
  for (const id of [...groundLayerIds, 'roam-buildings-3d', 'roam-player-model']) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}
