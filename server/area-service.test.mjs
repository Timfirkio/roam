import { afterEach, describe, expect, it } from 'vitest';
import { GeoJSONWrapper, fromVectorTileJs } from '@maplibre/vt-pbf';
import { AreaStore } from './area-store.mjs';
import { AreaService, publicRecord } from './area-service.mjs';
import { coveringTiles, measureTile, tileBounds } from './area-network.mjs';
import { bboxPolygon } from '@turf/turf';
import { uniqueLineMeters } from '../src/area-geometry.ts';
import { areaHttpServer } from './area-server.mjs';

const stores = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
const x = 9011, y = 4820;
const bounds = tileBounds(x, y);
const geometry = bboxPolygon([bounds[0] + 0.001, bounds[1] + 0.001, bounds[2] - 0.001, bounds[3] - 0.001]).geometry;
const area = { id: 'relation/123', name: 'Test municipality', adminLevel: 7, countryCode: 'SE', label: 'Kommun', geometry, boundaryVersion: 'v1', fetchedAt: Date.now() };
const template = 'https://example.test/snapshot/{z}/{x}/{y}.pbf';
function setup(fetcher) {
  const store = new AreaStore(':memory:'); stores.push(store); store.saveArea(area);
  return new AreaService(store, { tileTemplate: template, fetch: fetcher });
}
function tile() {
  const layer = new GeoJSONWrapper([{ type: 2, geometry: [[[100, 2000], [3900, 2000]]], tags: { class: 'minor' } }], { version: 2, extent: 4096 });
  layer.name = 'transportation';
  return fromVectorTileJs({ layers: { transportation: layer } });
}

describe('shared area calculation jobs', () => {
  it('deduplicates requests, stores totals and reuses the result for another caller', async () => {
    let reads = 0;
    const service = setup(async () => { reads++; return new Response(tile()); });
    const [first, second] = await Promise.all([service.request(area.id), service.request(area.id)]);
    expect(first.job.id).toBe(second.job.id);
    await service.worker;
    const result = await service.request(area.id);
    expect(result.job.status).toBe('ready'); expect(result.job.totals.lengthMeters).toBeGreaterThan(0);
    expect(reads).toBe(1);
    expect(publicRecord(result).job).not.toHaveProperty('tiles');
    await service.close();
  });
  it('fails rather than publishing partial totals and can retry', async () => {
    let fail = true;
    const service = setup(async () => fail ? new Response('', { status: 503 }) : new Response(tile()));
    await service.request(area.id); await service.worker;
    expect(service.record(service.store.area(area.id)).job.status).toBe('failed');
    expect(service.record(service.store.area(area.id)).job.totals).toBeNull();
    fail = false;
    await service.request(area.id); await service.worker;
    expect(service.record(service.store.area(area.id)).job.status).toBe('ready');
    await service.close();
  });
  it('reuses successful tile checkpoints after a restart', async () => {
    let reads = 0;
    const service = setup(async () => { reads++; return new Response(tile()); });
    await service.request(area.id); await service.worker;
    const job = service.store.jobs()[0];
    service.store.saveJob({ ...job, status: 'running', totals: null });
    const restarted = new AreaService(service.store, { tileTemplate: template, fetch: async () => { throw new Error('checkpoint was lost'); } });
    restarted.kick(); await restarted.worker;
    expect(restarted.record(area).job.status).toBe('ready'); expect(reads).toBe(1);
    await restarted.close(); await service.close();
  });
  it('resumes a partially completed multi-tile job without refetching its first tile', async () => {
    const requested = [];
    let fail = true;
    const service = setup(async url => {
      requested.push(url);
      return fail && url.endsWith(`/${x + 1}/${y}.pbf`) ? new Response('', { status: 503 }) : new Response(tile());
    });
    service.store.saveArea({ ...area, geometry: bboxPolygon([bounds[0] + 0.001, bounds[1] + 0.001, bounds[2] + 0.001, bounds[3] - 0.001]).geometry });
    await service.request(area.id); await service.worker;
    expect(service.store.jobs()[0].completedTiles).toBe(1);
    expect(service.store.jobs()[0].totals).toBeNull();
    fail = false;
    await service.request(area.id); await service.worker;
    expect(service.store.jobs()[0].status).toBe('ready');
    expect(requested.filter(url => url.endsWith(`/${x}/${y}.pbf`))).toHaveLength(1);
    await service.close();
  });
  it('does not automatically calculate a country or an expensive local area', async () => {
    const service = setup(async () => { throw new Error('should not download'); });
    service.store.saveArea({ ...area, adminLevel: 2 });
    expect((await service.request(area.id, true)).job).toBeNull();
    service.store.saveArea(area); service.options.autoTiles = 0;
    expect((await service.request(area.id, true)).job).toBeNull();
    await service.close();
  });
  it('invalidates a total when the source snapshot changes', async () => {
    const service = setup(async () => new Response(tile()));
    await service.request(area.id); await service.worker;
    service.options.tileTemplate = template.replace('snapshot', 'next');
    expect(service.record(area).job).toBeNull();
    await service.close();
  });
  it('rejects incomplete boundary provider responses and invalid coordinates', async () => {
    const service = setup(async () => Response.json({ remark: 'runtime error', elements: [] }));
    service.options.overpassUrl = 'https://example.test/overpass';
    await expect(service.lookup(18, 59)).rejects.toThrow('incomplete');
    await expect(service.lookup(181, 59)).rejects.toThrow('valid');
    await service.close();
  });
  it('caches normalized geocoder results and rejects an unconfigured search', async () => {
    let requests = 0;
    const service = setup(async url => {
      requests++;
      expect(String(url)).toContain('q=Liljeholmen');
      return Response.json([{ osm_type: 'relation', osm_id: 16436121, display_name: 'Liljeholmen, Stockholm', lon: '18.0223', lat: '59.3106', type: 'suburb' }]);
    });
    service.options.geocoderUrl = 'https://geocoder.test/search';
    await expect(service.search('Liljeholmen')).resolves.toEqual([{ id: 'relation/16436121', name: 'Liljeholmen, Stockholm', lng: 18.0223, lat: 59.3106, type: 'suburb' }]);
    await service.search('  liljeholmen ');
    expect(requests).toBe(1);
    service.options.geocoderUrl = undefined;
    await expect(service.search('Årsta')).rejects.toThrow('not configured');
    await service.close();
  });
});

describe('area API', () => {
  it('requires authorization, rejects untrusted origins and returns public job data', async () => {
    const service = setup(async () => new Response(tile()));
    const server = areaHttpServer(service, { authenticate: async header => header === 'Bearer test' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/areas/${area.id}`;
    try {
      expect((await fetch(base)).status).toBe(401);
      expect((await fetch(base, { headers: { Authorization: 'Bearer test', Origin: 'https://untrusted.test' } })).status).toBe(403);
      const response = await fetch(`${base}/calculate`, { method: 'POST', headers: { Authorization: 'Bearer test' } });
      expect(response.status).toBe(202);
      const record = await response.json();
      expect(record.job).not.toHaveProperty('boundary');
      expect(record.area).not.toHaveProperty('fetchedAt');
      await service.worker;
      const ready = await (await fetch(base, { headers: { Authorization: 'Bearer test' } })).json();
      expect(ready.job.status).toBe('ready');
      const areaWithGeometry = await (await fetch(`${base}?geometry=true`, { headers: { Authorization: 'Bearer test' } })).json();
      expect(areaWithGeometry.area.geometry).toEqual(geometry);
    } finally {
      await service.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
  it('allows configured web and Capacitor origins', async () => {
    const service = setup(async () => new Response(tile()));
    const server = areaHttpServer(service, { authenticate: async header => header === 'Bearer test', origin: 'https://roam-pied.vercel.app,http://localhost,https://localhost,capacitor://localhost' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/areas/${area.id}`;
    try {
      const response = await fetch(base, { headers: { Authorization: 'Bearer test', Origin: 'http://localhost' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost');
    } finally {
      await service.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
  it('serves catalog regions without a user session', async () => {
    const record = { area, job: null, automatic: true };
    const catalog = {
      catalog: true,
      boundaryTile: async () => tile(),
      lookup: async () => ({ areas: [record], source: 'Roam OSM catalog' }),
      search: async () => [{ id: area.id, name: area.name, lng: 18, lat: 59, type: 'Administrative level 7' }],
      boundary: async () => record,
    };
    const server = areaHttpServer(catalog, { authenticate: async () => false, origin: 'https://localhost' });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/areas`;
    try {
      expect((await fetch(`${base}/lookup?lng=18&lat=59`, { headers: { Origin: 'https://localhost' } })).status).toBe(200);
      expect((await fetch(`${base}/search?q=Test`, { headers: { Origin: 'https://localhost' } })).status).toBe(200);
      expect((await fetch(`${base}/${area.id}`, { headers: { Origin: 'https://localhost' } })).status).toBe(200);
      expect((await fetch(`${base}/${area.id}/calculate`, { method: 'POST', headers: { Origin: 'https://localhost' } })).status).toBe(401);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

describe('network tile ownership', () => {
  it('counts a road lying along a tile seam exactly once', () => {
    const road = { roadType: 'cycleway', coordinates: [[bounds[2], bounds[1] + 0.002], [bounds[2], bounds[3] - 0.002]] };
    const boundary = bboxPolygon([bounds[0], bounds[1], bounds[2] + 0.02, bounds[3]]).geometry;
    const sum = measureTile([road], x, y, boundary).lengthMeters + measureTile([road], x + 1, y, boundary).lengthMeters;
    expect(sum).toBeCloseTo(uniqueLineMeters([road.coordinates]), 5);
  });
  it('bounds work before enumerating a continent and rejects dateline ambiguity', () => {
    expect(() => coveringTiles(bboxPolygon([-20, -40, 60, 40]).geometry, 32)).toThrow('too large');
    expect(() => coveringTiles(bboxPolygon([-179, 0, 179, 1]).geometry, 32)).toThrow('dateline');
  });
});
