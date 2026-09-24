import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { RULES_VERSION } from '../server/area-network.mjs';

const databaseUrl = process.env.AREA_DATABASE_URL;
const pbf = process.env.SWEDEN_PBF ?? '/data/sweden-latest.osm.pbf';
const requestedAreaId = process.argv[2];
if (!databaseUrl) throw new Error('AREA_DATABASE_URL is required.');

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pool = new pg.Pool({ connectionString: databaseUrl });

function run(command, args, environment = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, ...environment } });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}.`);
}

async function queueCoverage(areaId) {
  const { rows } = await pool.query(`
    select child.id, child.boundary_version, child.source_version
    from osm.boundaries parent
    join osm.boundaries child on child.id = parent.id or (
      child.country_code = 'SE'
      and child.admin_level between 7 and 9
      and gis.ST_Covers(parent.geometry, gis.ST_PointOnSurface(child.geometry)))
    where parent.id = $1
    order by child.admin_level, child.name`, [areaId]);
  if (rows.length < 2) throw new Error(`No Swedish municipality or level-9 boundaries found inside ${areaId}.`);
  await pool.query(`delete from osm.coverage_jobs job using osm.boundaries child, osm.boundaries parent
    where parent.id = $1 and job.area_id = child.id and (
      child.id = parent.id or (child.country_code = 'SE'
        and child.admin_level between 7 and 9
        and gis.ST_Covers(parent.geometry, gis.ST_PointOnSurface(child.geometry))))`, [areaId]);
  const values = rows.map(row => [digest([row.id, row.boundary_version, row.source_version, RULES_VERSION]), row.id, row.boundary_version, row.source_version, RULES_VERSION]);
  const placeholders = values.map((_, index) => `($${index * 5 + 1}, $${index * 5 + 2}, $${index * 5 + 3}, $${index * 5 + 4}, $${index * 5 + 5}, 'queued')`).join(', ');
  await pool.query(`insert into osm.coverage_jobs (id, area_id, boundary_version, source_version, rules_version, status) values ${placeholders}`, values.flat());
  return rows.length;
}

let batch;
try {
  await pool.query('begin');
  const { rows } = await pool.query(`
    select batch.area_id, batch.source_region_id, batch.name,
      concat_ws(',', gis.ST_XMin(gis.ST_Envelope(boundary.geometry)), gis.ST_YMin(gis.ST_Envelope(boundary.geometry)), gis.ST_XMax(gis.ST_Envelope(boundary.geometry)), gis.ST_YMax(gis.ST_Envelope(boundary.geometry))) as bbox,
      exists(select 1 from osm.roads where source_region_id = batch.source_region_id) as has_roads
    from osm.sweden_batches batch join osm.boundaries boundary on boundary.id = batch.area_id
    where batch.status in ('pending', 'failed') ${requestedAreaId ? 'and batch.area_id = $1' : ''}
    order by case when batch.area_id = 'relation/54391' then 0 else 1 end, gis.ST_Area(boundary.geometry), batch.name
    limit 1 for update skip locked`, requestedAreaId ? [requestedAreaId] : []);
  batch = rows[0];
  if (!batch) throw new Error(requestedAreaId ? `No pending Sweden batch for ${requestedAreaId}.` : 'No Sweden county batches are pending.');
  await pool.query(`update osm.sweden_batches set status = 'running', error = null, started_at = now(), updated_at = now() where area_id = $1`, [batch.area_id]);
  await pool.query('commit');

  if (!batch.has_roads) {
    // osm2pgsql reads the national PBF sequentially but only materializes this
    // county's bounding box. Trim to the exact administrative polygon below.
    run('node', ['scripts/import-osm-region.mjs', batch.source_region_id, 'SE', pbf, '--roads-only', '--bbox', batch.bbox], { OSM2PGSQL_CACHE_MB: process.env.OSM2PGSQL_CACHE_MB ?? '768', OSM_DOWNLOAD_URL: 'https://download.geofabrik.de/europe/sweden-latest.osm.pbf' });
    await pool.query(`delete from osm.roads road using osm.boundaries boundary
      where road.source_region_id = $1 and boundary.id = $2
        and not gis.ST_Intersects(road.geometry, boundary.geometry)`, [batch.source_region_id, batch.area_id]);
  }
  const count = await queueCoverage(batch.area_id);
  run('node', ['scripts/process-area-coverage.mjs', '1']);
  const { rows: incomplete } = await pool.query(`
    select job.status, job.error from osm.coverage_jobs job join osm.boundaries child on child.id = job.area_id
    where (child.id = $1 or (child.country_code = 'SE' and child.admin_level between 7 and 9
      and gis.ST_Covers((select geometry from osm.boundaries where id = $1), gis.ST_PointOnSurface(child.geometry))))
      and job.status <> 'ready' limit 1`, [batch.area_id]);
  if (incomplete[0]) throw new Error(incomplete[0].error ?? `Coverage job finished as ${incomplete[0].status}.`);
  await pool.query(`update osm.sweden_batches set status = 'ready', completed_at = now(), updated_at = now() where area_id = $1`, [batch.area_id]);
  console.log(`Completed ${batch.name}; calculated its län total and ${count - 1} municipality and local-area totals.`);
} catch (error) {
  await pool.query('rollback').catch(() => {});
  if (batch) await pool.query(`update osm.sweden_batches set status = 'failed', error = $2, updated_at = now() where area_id = $1`, [batch.area_id, error instanceof Error ? error.message : String(error)]);
  throw error;
} finally {
  await pool.end();
}
