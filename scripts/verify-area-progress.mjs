// A bounded, manual integration check. This is not the production boundary source.
// Supply AREA_OVERPASS_URL explicitly; at most one small area and 32 tiles are used.
import { readFileSync } from 'node:fs';
import { AreaStore } from '../server/area-store.mjs';
import { AreaService } from '../server/area-service.mjs';

const overpassUrl = process.env.AREA_OVERPASS_URL;
if (!overpassUrl) throw new Error('Set AREA_OVERPASS_URL for this manual integration check.');
const catalog = JSON.parse(readFileSync(new URL('../src/data/road-network-stockholm.json', import.meta.url)));
const store = new AreaStore(':memory:');
const service = new AreaService(store, { overpassUrl, tileTemplate: catalog.source.tileTemplate, maxTiles: 32 });
try {
  // Sundbyberg, outside Stockholm municipality.
  const result = await service.lookup(17.971, 59.361);
  console.log(JSON.stringify(result.areas.map(({ area }) => ({ id: area.id, name: area.name, level: area.adminLevel, label: area.label }))));
  const local = result.areas.filter(r => r.area.adminLevel >= 7).at(-1);
  if (!local) throw new Error('No local administrative area found.');
  await service.request(local.area.id);
  await service.worker;
  const first = service.record(store.area(local.area.id));
  const second = await service.request(local.area.id);
  if (first.job.status !== 'ready') throw new Error(first.job.error);
  if (first.job.id !== second.job.id || first.job.totals.lengthMeters <= 0) throw new Error('Shared total reuse failed.');
  console.log(JSON.stringify({ name: first.area.name, tiles: first.job.totalTiles, totals: first.job.totals, reused: true }));
} finally { await service.close(); store.close(); }
