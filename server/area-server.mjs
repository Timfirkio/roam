import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { AreaStore } from './area-store.mjs';
import { AreaService, publicRecord } from './area-service.mjs';

export function areaHttpServer(service, { authenticate = async () => true, origin } = {}) {
  const budgets = new Map();
  return createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (origin && req.headers.origin === origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      if (req.headers.origin) {
        const caller = new URL(req.headers.origin);
        const allowed = origin ? req.headers.origin === origin : ['localhost', '127.0.0.1', '[::1]'].includes(caller.hostname);
        if (!allowed) { send(403, { error: 'Origin not allowed.' }); return; }
      }
      if (!await authenticate(req.headers.authorization)) { send(401, { error: 'Sign in to calculate area coverage.' }); return; }
      const url = new URL(req.url, 'http://localhost');
      const expensive = req.method === 'POST' || url.pathname.endsWith('/lookup');
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
      const match = /^\/api\/areas\/relation\/(\d+)(\/calculate)?$/.exec(url.pathname);
      if (!match) { send(404, { error: 'Area endpoint not found.' }); return; }
      const id = `relation/${match[1]}`;
      if (req.method === 'POST' && match[2]) {
        send(202, publicRecord(await service.request(id, url.searchParams.get('automatic') === 'true'))); return;
      }
      if (req.method === 'GET' && !match[2]) {
        const area = service.store.area(id);
        if (!area) { send(404, { error: 'Area not found.' }); return; }
        send(200, publicRecord(service.record(area))); return;
      }
      send(405, { error: 'Method not allowed.' });
    } catch (error) { send(400, { error: error instanceof Error ? error.message : 'Area service unavailable.' }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.AREA_HOST ?? '127.0.0.1';
  const port = Number(process.env.AREA_PORT ?? 8787);
  const directory = resolve(process.env.AREA_DATA_DIR ?? '.roam-data');
  mkdirSync(directory, { recursive: true });
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
  const store = new AreaStore(resolve(directory, 'areas.sqlite'));
  const service = new AreaService(store, { tileTemplate, maxTiles, overpassUrl: process.env.AREA_OVERPASS_URL });
  const server = areaHttpServer(service, {
    origin: process.env.AREA_ALLOWED_ORIGIN,
    authenticate: auth ? async header => {
      const token = /^Bearer (.+)$/.exec(header ?? '')?.[1];
      if (!token) return false;
      const { data, error } = await auth.auth.getUser(token);
      return !error && Boolean(data.user);
    } : undefined,
  });
  server.listen(port, host, () => { console.log(`Area service listening on http://${host}:${port}`); service.kick(); });
  const stop = () => server.close(async () => { await service.close(); store.close(); });
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
