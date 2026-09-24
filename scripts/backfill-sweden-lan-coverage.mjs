import { createHash } from 'node:crypto';
import pg from 'pg';
import { RULES_VERSION } from '../server/area-network.mjs';
import { PostgisAreaService } from '../server/postgis-area-service.mjs';

const databaseUrl = process.env.AREA_DATABASE_URL;
if (!databaseUrl) throw new Error('AREA_DATABASE_URL is required.');

const pool = new pg.Pool({ connectionString: databaseUrl });
const worker = new PostgisAreaService(databaseUrl);
try {
  const { rows: areas } = await pool.query(`
    select boundary.id, boundary.name, boundary.boundary_version, boundary.source_version,
      exists(select 1 from osm.roads where source_region_id = batch.source_region_id) as has_roads
    from osm.sweden_batches batch
    join osm.boundaries boundary on boundary.id = batch.area_id
    where batch.status = 'ready'
    order by boundary.name`);
  for (const area of areas) {
    if (!area.has_roads) throw new Error(`${area.name} is marked ready but has no imported roads.`);
    const id = createHash('sha256').update(JSON.stringify([area.id, area.boundary_version, area.source_version, RULES_VERSION])).digest('hex');
    await pool.query(`
      insert into osm.coverage_jobs (id, area_id, boundary_version, source_version, rules_version, status)
      values ($1, $2, $3, $4, $5, 'queued')
      on conflict (area_id, boundary_version, source_version, rules_version)
      do update set status = 'queued', error = null, totals = null, updated_at = now()
      where osm.coverage_jobs.status = 'failed'`,
    [id, area.id, area.boundary_version, area.source_version, RULES_VERSION]);
  }
  await worker.run();
  const incomplete = [];
  for (const area of areas) {
    const job = await worker.latestJob({
      id: area.id,
      boundaryVersion: area.boundary_version,
      sourceVersion: area.source_version,
    });
    if (job?.status !== 'ready') incomplete.push(`${area.name}: ${job?.error ?? job?.status ?? 'missing'}`);
  }
  if (incomplete.length) throw new Error(`Län coverage remains incomplete: ${incomplete.join('; ')}`);
  console.log(`Län coverage is ready for ${areas.length} completed Sweden batches.`);
} finally {
  await worker.close();
  await pool.end();
}
