import { createHash } from 'node:crypto';
import osmtogeojson from 'osmtogeojson';
import { administrativeLabel } from '../src/area-types.ts';
import { emptyAreaTotals } from '../src/area-geometry.ts';
import { coveringTiles, decodeNetworkTile, measureTile, RULES_VERSION } from './area-network.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class AreaService {
  constructor(store, options) {
    this.store = store;
    this.options = { maxTiles: 1024, autoTiles: 32, maxQueued: 20, fetch: globalThis.fetch, ...options };
    this.pending = new Map();
    this.active = false;
    this.closed = false;
    this.worker = null;
    for (const job of store.jobs()) if (job.status === 'running') store.saveJob({ ...job, status: 'queued' });
  }
  async once(key, fn) {
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = fn().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  async overpass(query) {
    if (!this.options.overpassUrl) throw new Error('Area boundary service is not configured.');
    const response = await this.options.fetch(this.options.overpassUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'Roam-area-service/0.1' },
      body: new URLSearchParams({ data: `[out:json][timeout:45];${query}` }), signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok) throw new Error(`Boundary provider unavailable (${response.status}). Try again later.`);
    const data = await response.json();
    if (data.remark) throw new Error('Boundary provider returned incomplete data. Try again later.');
    return data;
  }
  async lookup(lng, lat) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85.05112878) throw new Error('Choose a valid map location.');
    const key = `${lng},${lat}`;
    return this.once(`lookup:${key}`, async () => {
      let ids = this.store.lookup(key);
      if (!ids) {
        const data = await this.overpass(`is_in(${lat},${lng})->.a;area.a["boundary"="administrative"]["admin_level"];out tags;`);
        const elements = data.elements.filter(e => e.type === 'area' && e.id >= 3_600_000_000 && e.tags?.name && /^\d+$/.test(e.tags.admin_level));
        const countryTags = elements.find(e => e.tags.admin_level === '2')?.tags;
        const country = countryTags?.['ISO3166-1:alpha2'] ?? countryTags?.['ISO3166-1'] ?? '';
        ids = [];
        for (const element of elements) {
          const id = `relation/${element.id - 3_600_000_000}`;
          const existing = this.store.area(id);
          const area = {
            id, name: element.tags.name, adminLevel: Number(element.tags.admin_level), countryCode: country,
            label: administrativeLabel(country, Number(element.tags.admin_level)),
            boundaryVersion: existing?.boundaryVersion ?? '', geometry: existing?.geometry ?? null,
            fetchedAt: existing?.fetchedAt ?? 0,
          };
          this.store.saveArea(area); ids.push(id);
        }
        this.store.saveLookup(key, ids);
      }
      return { areas: ids.map(id => this.record(this.store.area(id))).sort((a, b) => a.area.adminLevel - b.area.adminLevel), source: 'OpenStreetMap' };
    });
  }
  async search(query) {
    const normalized = String(query ?? '').trim().replace(/\s+/g, ' ');
    if (normalized.length < 2) return [];
    if (normalized.length > 120) throw new Error('Use a shorter location search.');
    const key = normalized.toLocaleLowerCase();
    const cached = this.store.search(key);
    if (cached) return cached;
    if (!this.options.geocoderUrl) throw new Error('Location search is not configured.');
    const url = new URL(this.options.geocoderUrl);
    url.searchParams.set('q', normalized);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '6');
    url.searchParams.set('addressdetails', '1');
    const response = await this.options.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Roam-area-service/0.1' }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Location search unavailable (${response.status}). Try again later.`);
    const results = (await response.json()).filter(entry => Number.isFinite(Number(entry.lon)) && Number.isFinite(Number(entry.lat))).map(entry => ({
      id: `${entry.osm_type}/${entry.osm_id}`, name: String(entry.display_name), lng: Number(entry.lon), lat: Number(entry.lat), type: String(entry.type ?? entry.category ?? 'place'),
    }));
    this.store.saveSearch(key, results);
    return results;
  }
  jobId(area) { return digest([area.id, area.boundaryVersion, this.options.tileTemplate, RULES_VERSION]); }
  record(area) {
    const job = area.boundaryVersion ? this.store.job(this.jobId(area)) : null;
    return { area, job, automatic: area.adminLevel >= 7 && (job?.totalTiles ?? Infinity) <= this.options.autoTiles };
  }
  async boundary(id) {
    return this.once(`boundary:${id}`, async () => {
      let area = this.store.area(id);
      if (!area) throw new Error('Look up this area before calculating its coverage.');
      if (area.geometry && Date.now() - area.fetchedAt < 7 * 86_400_000) return area;
      const data = await this.overpass(`rel(${id.split('/')[1]});out meta geom;`);
      const converted = osmtogeojson(data, { flatProperties: false }).features.find(f => f.id === id);
      if (!converted || converted.properties.tainted || !['Polygon', 'MultiPolygon'].includes(converted.geometry?.type)) {
        throw new Error('This area has no complete OSM boundary polygon. Choose an enclosing area.');
      }
      area = { ...area, geometry: converted.geometry, boundaryVersion: digest(converted.geometry), fetchedAt: Date.now() };
      this.store.saveArea(area);
      return area;
    });
  }
  async request(id, automatic = false) {
    if (!/^relation\/\d+$/.test(id)) throw new Error('Invalid area identifier.');
    return this.once(`request:${id}:${automatic}`, async () => {
      const existing = this.store.area(id);
      if (!existing) throw new Error('Look up this area first.');
      if (automatic && existing.adminLevel < 7) return this.record(existing);
      const area = await this.boundary(id);
      const tiles = coveringTiles(area.geometry, this.options.maxTiles);
      const old = this.store.job(this.jobId(area));
      if (old && old.status !== 'failed') return this.record(area);
      if (automatic && tiles.length > this.options.autoTiles) return this.record(area);
      if (this.store.jobs().filter(j => ['queued', 'running'].includes(j.status)).length >= this.options.maxQueued) throw new Error('The calculation queue is full. Try again later.');
      this.store.saveJob({
        id: this.jobId(area), areaId: id, boundaryVersion: area.boundaryVersion,
        networkVersion: this.options.tileTemplate, rulesVersion: RULES_VERSION,
        status: 'queued', completedTiles: 0, totalTiles: tiles.length, totals: null, error: null,
        // Keep the exact polygon and tile manifest private so a later boundary refresh cannot change a running job.
        boundary: area.geometry, tiles,
      });
      this.kick();
      return this.record(area);
    });
  }
  kick() {
    if (this.active || this.closed) return;
    this.active = true;
    this.worker = this.drain().finally(() => { this.active = false; });
  }
  async drain() {
    while (!this.closed) {
      const job = this.store.jobs().find(j => j.status === 'queued');
      if (!job) break;
      job.status = 'running'; this.store.saveJob(job);
      try {
        const totals = emptyAreaTotals();
        for (const [index, [x, y]] of job.tiles.entries()) {
          if (this.closed) { this.store.saveJob({ ...job, status: 'queued' }); return; }
          const key = `${x}/${y}`;
          let tileTotal = this.store.checkpoint(job.id, key);
          if (!tileTotal) {
            const cacheKey = `${job.networkVersion}:${RULES_VERSION}:${key}`;
            let roads = this.store.tile(cacheKey);
            if (!roads) {
              const url = job.networkVersion.replace('{z}', '14').replace('{x}', String(x)).replace('{y}', String(y));
              const response = await this.options.fetch(url, { signal: AbortSignal.timeout(30_000) });
              if (!response.ok) throw new Error(`Road tile unavailable (${response.status}). Retry to resume this calculation.`);
              roads = decodeNetworkTile(await response.arrayBuffer(), x, y);
              this.store.saveTile(cacheKey, roads);
            }
            tileTotal = measureTile(roads, x, y, job.boundary);
            this.store.saveCheckpoint(job.id, key, tileTotal);
          }
          totals.lengthMeters += tileTotal.lengthMeters;
          for (const type of Object.keys(totals.byRoadType)) totals.byRoadType[type] += tileTotal.byRoadType[type];
          job.completedTiles = index + 1; this.store.saveJob(job);
          await new Promise(resolve => setImmediate(resolve));
        }
        this.store.saveJob({ ...job, status: 'ready', totals, error: null });
      } catch (error) {
        this.store.saveJob({ ...job, status: 'failed', totals: null, error: error instanceof Error ? error.message : 'Calculation failed. Retry to resume.' });
      }
    }
  }
  async close() { this.closed = true; await this.worker; }
}

export function publicRecord(record) {
  const { fetchedAt, ...area } = record.area;
  if (!record.job) return { ...record, area };
  const { boundary, tiles, ...job } = record.job;
  return { ...record, area, job };
}
