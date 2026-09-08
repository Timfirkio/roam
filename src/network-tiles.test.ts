import { describe, expect, it, vi } from 'vitest';
import { VectorTile } from '@mapbox/vector-tile';
import { GeoJSONWrapper, fromVectorTileJs } from '@maplibre/vt-pbf';
import { PbfReader } from 'pbf';
import { createNetworkTileLoader, mergeNetworkTiles } from './network-tiles';

function fixture() {
  const layer = new GeoJSONWrapper([
    { id: 434713008, type: 2, tags: { class: 'path', subclass: 'cycleway', bicycle: 'designated', surface: 'unpaved' }, geometry: [[[-100, 2048], [2048, 2048], [4196, 2048]]] },
  ], { version: 2, extent: 4096 });
  layer.name = 'transportation';
  return Uint8Array.from(fromVectorTileJs({ layers: { transportation: layer } })).buffer;
}
const decode = (data: ArrayBuffer) => new VectorTile(new PbfReader(data)).layers.transportation;

describe('complete cycling network tiles', () => {
  it.each([12, 13])('preserves cycleway tags and geographic position at z%i', (zoom: number) => {
    const scale = 2 ** (14 - zoom);
    const tile = decode(mergeNetworkTiles([{ data: fixture(), dx: 1, dy: 1 }], zoom));
    const feature = tile.feature(0);
    expect(feature.properties).toMatchObject({ subclass: 'cycleway', bicycle: 'designated', surface: 'unpaved' });
    const midpoint = feature.loadGeometry()[0][1];
    expect(midpoint.x / tile.extent).toBe(1.5 / scale);
    expect(midpoint.y / tile.extent).toBe(1.5 / scale);
  });

  it('clips internal child buffers to a shared seam without a gap', () => {
    const tile = decode(mergeNetworkTiles([{ data: fixture(), dx: 0, dy: 0 }, { data: fixture(), dx: 1, dy: 0 }], 13));
    expect(tile.feature(0).loadGeometry()[0].at(-1)?.x).toBe(4096);
    expect(tile.feature(1).loadGeometry()[0][0].x).toBe(4096);
  });

  it('loads all 16 children on a cold z12 view, reuses them at z13 and z14, and returns transferable copies', async () => {
    const fetcher = vi.fn(async () => new Response(fixture()));
    const load = createNetworkTileLoader('https://tiles.test/{z}/{x}/{y}', fetcher);
    const signal = new AbortController().signal;
    expect(decode(await load(12, 2253, 1205, signal)).length).toBe(16);
    expect(fetcher).toHaveBeenCalledTimes(16);
    expect(decode(await load(13, 4506, 2410, signal)).length).toBe(4);
    const detail = await load(14, 9013, 4820, signal);
    structuredClone(detail, { transfer: [detail] });
    expect(decode(await load(14, 9013, 4820, signal)).length).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(16);
  });

  it('caps simultaneous requests across parent tiles', async () => {
    let active = 0, peak = 0;
    const load = createNetworkTileLoader('https://tiles.test/{z}/{x}/{y}', async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; return new Response(fixture());
    });
    await Promise.all([load(12, 1, 1, new AbortController().signal), load(12, 2, 1, new AbortController().signal)]);
    expect(peak).toBe(6);
  });

  it('rejects failures and permits a later retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockImplementation(async () => new Response(fixture()));
    const load = createNetworkTileLoader('https://tiles.test/{z}/{x}/{y}', fetcher);
    await expect(load(14, 1, 1, new AbortController().signal)).rejects.toThrow('503');
    expect(decode(await load(14, 1, 1, new AbortController().signal)).length).toBe(1);
  });

  it('does not fetch cancelled requests or unsupported overview zooms', async () => {
    const fetcher = vi.fn();
    const load = createNetworkTileLoader('https://tiles.test/{z}/{x}/{y}', fetcher);
    const controller = new AbortController(); controller.abort();
    await expect(load(12, 1, 1, controller.signal)).rejects.toThrow();
    await expect(load(11, 1, 1, new AbortController().signal)).rejects.toThrow('Unsupported');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
