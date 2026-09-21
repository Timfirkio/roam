import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { AreaStore } from './area-store.mjs';
import { AreaService, publicRecord } from './area-service.mjs';
import { PostgisAreaService } from './postgis-area-service.mjs';

export function areaHttpServer(service, { authenticate = async () => true, origin } = {}) {
  const budgets = new Map();
  return createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    const sendTile = tile => { res.writeHead(200, { 'Content-Type': 'application/vnd.mapbox-vector-tile', 'Cache-Control': 'public, max-age=300' }); res.end(tile); };
    if (origin && req.headers.origin === origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.headers.origin) {
        const caller = new URL(req.headers.origin);
        const allowed = origin ? req.headers.origin === origin : ['localhost', '127.0.0.1', '[::1]'].includes(caller.hostname);
        if (!allowed) { send(403, { error: 'Origin not allowed.' }); return; }
      }
      const tile = /^\/api\/areas\/tiles\/(\d+)\/(\d+)\/(\d+)\.mvt$/.exec(url.pathname);
      // Boundary tiles contain public OSM geometry only. Leaving them
      // unauthenticated lets MapLibre cache and pan them without a browser
      // token, while every record and coverage request remains user-authenticated.
      if (req.method === 'GET' && tile && service.catalog) {
        sendTile(await service.boundaryTile(...tile.slice(1).map(Number))); return;
      }
      if (!await authenticate(req.headers.authorization)) { send(401, { error: 'Sign in to calculate area coverage.' }); return; }
      const expensive = req.method === 'POST' || (!service.catalog && (url.pathname.endsWith('/lookup') || url.pathname.endsWith('/search')));
      if (expensive) {
        const now = Date.now(), key = req.socket.remoteAddress;
        for (const [ip, budget] of budgets) if (budget.until < now) budgets.delete(ip);
        const budget = budgets.get(key) ?? { until: now + 60_000, count: 0 };
        if (++budget.count > 30) { send(429, { error: 'Too many area requests. Try again in a minute.' }); return; }
        budgets.set(key, budget);
      }
      if (req.method === 'GET' && url.pathname === '/api/areas/lookup') {
        if (!url.searchParams.has('lng') || !url.searchParams.has('lat')) throw new Error('A map location is required.');
        const result = await service.lookup(Number(url.searchParams.get('lng')), Number(url.searchParams.get('lat')));
        send(200, { ...result, areas: result.areas.map(publicRecord) }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/areas/search') {
        send(200, { results: await service.search(url.searchParams.get('q')) }); return;
      }
      if (req.method === 'GET' && tile) {
        if (!service.catalog) { send(404, { error: 'Boundary tiles require the PostGIS catalog.' }); return; }
        sendTile(await service.boundaryTile(...tile.slice(1).map(Number))); return;
      }
      const match = /^\/api\/areas\/relation\/(\d+)(\/calculate)?$/.exec(url.pathname);
      if (!match) { send(404, { error: 'Area endpoint not found.' }); return; }
      const id = `relation/${match[1]}`;
      if (req.method === 'POST' && match[2]) {
        send(202, publicRecord(await service.request(id, url.searchParams.get('automatic') === 'true'))); return;
      }
      if (req.method === 'GET' && !match[2]) {
        // The PostGIS service has no legacy SQLite store. Its boundary lookup
        // returns the complete record directly, including geometry when needed.
        let record;
        if (service.catalog) {
          record = await service.boundary(id);
        } else {
          const area = service.store.area(id);
          record = area
            ? (url.searchParams.get('geometry') === 'true' ? service.record(await service.boundary(id)) : service.record(area))
            : null;
        }
        if (!record) { send(404, { error: 'Area not found.' }); return; }
        send(200, publicRecord(record)); return;
      }
      send(405, { error: 'Method not allowed.' });
    } catch (error) { send(400, { error: error instanceof Error ? error.message : 'Area service unavailable.' }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.AREA_HOST ?? '127.0.0.1';
  const port = Number(process.env.AREA_PORT ?? 8787);
  const directory = resolve(process.env.AREA_DATA_DIR ?? '.roam-data');
  // The production catalog is wholly in PostGIS. Keep the legacy SQLite
  // directory out of that container so its runtime can stay unprivileged.
  if (!process.env.AREA_DATABASE_URL) mkdirSync(directory, { recursive: true });
  const catalog = JSON.parse(readFileSync(new URL('../src/data/road-network-stockholm.json', import.meta.url), 'utf8'));
  const tileTemplate = process.env.AREA_TILE_TEMPLATE ?? catalog.source.tileTemplate;
  if (!tileTemplate.startsWith('https://') || !['{z}', '{x}', '{y}'].every(token => tileTemplate.includes(token))) throw new Error('AREA_TILE_TEMPLATE must be a versioned HTTPS XYZ template.');
  const maxTiles = Number(process.env.AREA_MAX_TILES ?? 1024);
  if (!Number.isSafeInteger(maxTiles) || maxTiles < 1 || maxTiles > 100_000) throw new Error('AREA_MAX_TILES must be between 1 and 100000.');
  const local = host === '127.0.0.1' || host === '::1';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!local && (!url || !key || !process.env.AREA_ALLOWED_ORIGIN)) throw new Error('Remote area service requires Supabase auth and AREA_ALLOWED_ORIGIN.');
  const auth = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  const store = process.env.AREA_DATABASE_URL ? null : new AreaStore(resolve(directory, 'areas.sqlite'));
  const service = process.env.AREA_DATABASE_URL
    ? new PostgisAreaService(process.env.AREA_DATABASE_URL)
    : new AreaService(store, { tileTemplate, maxTiles, overpassUrl: process.env.AREA_OVERPASS_URL, geocoderUrl: process.env.AREA_GEOCODER_URL });
  const server = areaHttpServer(service, {
    origin: process.env.AREA_ALLOWED_ORIGIN,
    authenticate: auth ? async header => {
      const token = /^Bearer (.+)$/.exec(header ?? '')?.[1];
      if (!token) return false;
      const { data, error } = await auth.auth.getUser(token);
      return !error && Boolean(data.user);
    } : undefined,
  });
  server.listen(port, host, () => { console.log(`Area service listening on http://${host}:${port} (${service.catalog ? 'PostGIS catalog' : 'legacy cache'})`); service.kick(); });
  const stop = () => server.close(async () => { await service.close(); store?.close(); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
