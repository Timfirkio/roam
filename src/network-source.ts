import maplibregl, { type Map, type VectorTileSource } from 'maplibre-gl';
import { createNetworkTileLoader, NETWORK_DETAIL_ZOOM, NETWORK_MIN_ZOOM } from './network-tiles';

export const NETWORK_SOURCE = 'roam-network-detail';
let instance = 0;

export function installNetworkSource(map: Map): () => void {
  const base = map.getSource<VectorTileSource>('openmaptiles');
  const template = base?.tiles?.[0];
  if (!template || base.scheme !== 'xyz' || base.maxzoom < NETWORK_DETAIL_ZOOM) {
    console.warn('Full-detail network unavailable: expected XYZ tiles through zoom 14.');
    return () => {};
  }
  const protocol = `roam-network-${++instance}`;
  const load = createNetworkTileLoader(template);
  maplibregl.addProtocol(protocol, async (request, controller) => {
    const [z, x, y] = request.url.slice(`${protocol}://`.length).split('/').map(Number);
    return { data: await load(z, x, y, controller.signal) };
  });
  map.addSource(NETWORK_SOURCE, {
    type: 'vector', tiles: [`${protocol}://{z}/{x}/{y}`],
    minzoom: NETWORK_MIN_ZOOM, maxzoom: NETWORK_DETAIL_ZOOM,
    attribution: base.serialize().attribution,
  });
  return () => maplibregl.removeProtocol(protocol);
}
