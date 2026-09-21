import { createHash } from 'node:crypto';
import pg from 'pg';
import { RULES_VERSION } from '../server/area-network.mjs';

const [sourceRegionId, minLevel = '4', maxLevel = '10'] = process.argv.slice(2);
const databaseUrl = process.env.AREA_DATABASE_URL;
const levels = [Number(minLevel), Number(maxLevel)];
if (!sourceRegionId || !/^[a-z0-9-]+$/.test(sourceRegionId) || !databaseUrl || levels.some(level => !Number.isInteger(level) || level < 2 || level > 11) || levels[0] > levels[1]) {
  throw new Error('Usage: AREA_DATABASE_URL=... node scripts/queue-area-coverage.mjs <source-region-id> [minimum-admin-level] [maximum-admin-level]');
}

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const { rows } = await pool.query(`
    select id, boundary_version, source_version
    from osm.boundaries
    where source_region_id = $1 and admin_level between $2 and $3
    order by admin_level, name`, [sourceRegionId, ...levels]);
  if (!rows.length) throw new Error(`No administrative boundaries at levels ${levels[0]}–${levels[1]} were found for ${sourceRegionId}.`);
  const values = rows.map(row => [
    digest([row.id, row.boundary_version, row.source_version, RULES_VERSION]),
    row.id,
    row.boundary_version,
    row.source_version,
    RULES_VERSION,
  ]);
  const placeholders = values.map((_, rowIndex) => `($${rowIndex * 5 + 1}, $${rowIndex * 5 + 2}, $${rowIndex * 5 + 3}, $${rowIndex * 5 + 4}, $${rowIndex * 5 + 5}, 'queued')`).join(', ');
  const { rowCount } = await pool.query(`
    insert into osm.coverage_jobs (id, area_id, boundary_version, source_version, rules_version, status)
    values ${placeholders}
    on conflict (area_id, boundary_version, source_version, rules_version) do nothing`, values.flat());
  console.log(`Queued ${rowCount} new coverage calculations; ${rows.length - rowCount} already had totals or were queued.`);
} finally {
  await pool.end();
}
