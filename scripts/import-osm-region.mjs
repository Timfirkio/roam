import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const [regionId, countryCode, pbf, ...flags] = process.argv.slice(2);
const databaseUrl = process.env.AREA_DATABASE_URL;
const replacementRegionIds = (process.env.IMPORT_REPLACE_REGIONS ?? '').split(',').filter(Boolean);
let downloadUrl = process.env.OSM_DOWNLOAD_URL ?? 'manual-import';
for (let index = 0; index < flags.length; index += 1) {
  if (flags[index] === '--replace-region') replacementRegionIds.push(flags[++index]);
  else if (flags[index] === '--download-url') downloadUrl = flags[++index];
  else throw new Error(`Unknown import option: ${flags[index]}`);
}
if (!regionId || !/^[a-z0-9-]+$/.test(regionId) || !countryCode || !/^[A-Z]{2}$/.test(countryCode) || !pbf || !databaseUrl || replacementRegionIds.some(id => !/^[a-z0-9-]+$/.test(id)) || !downloadUrl) {
  throw new Error('Usage: AREA_DATABASE_URL=... node scripts/import-osm-region.mjs <region-id> <COUNTRY-CODE> <extract.osm.pbf> [--replace-region <region-id>] [--download-url <url>]');
}
const input = resolve(pbf);
if (!existsSync(input)) throw new Error(`OSM extract not found: ${input}`);
const style = resolve('osm/roam-import.lua');
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  // Flex output tables persist between imports. Clear only the importer-owned
  // staging tables; the live catalog is replaced later in one transaction.
  await pool.query('drop table if exists osm_import.boundaries_stage, osm_import.roads_stage');
  // PostGIS is deliberately installed in the private `gis` schema. osm2pgsql
  // creates its Flex output through libpq, so give that import session the same
  // schema path rather than exposing the extension in `public`.
  const imported = spawnSync('osm2pgsql', ['--create', '--slim', '--output=flex', '--style', style, '--database', databaseUrl, input], {
    stdio: 'inherit',
    env: { ...process.env, PGOPTIONS: `${process.env.PGOPTIONS ?? ''} -c search_path=gis,public` },
  });
  if (imported.error) throw new Error(`Could not run osm2pgsql: ${imported.error.message}`);
  if (imported.status !== 0) throw new Error(`osm2pgsql exited with ${imported.status}.`);
  await pool.query('begin');
  // Relations and ways can appear in overlapping extracts. Replacing the
  // explicitly superseded catalog in the same transaction keeps the live
  // boundaries and their road source together. The environment form is used
  // by Compose because command-line flags can be consumed by its own parser.
  const regionsToReplace = [...new Set([regionId, ...replacementRegionIds])];
  await pool.query('delete from osm.import_regions where id = any($1::text[])', [regionsToReplace]);
  // A prior extract may have used a different catalog ID. Remove only its
  // boundary records that collide with this source; its remaining catalog can
  // still be refreshed independently, while the new source owns each relation.
  await pool.query(`delete from osm.boundaries existing
    using osm_import.boundaries_stage staged
    where existing.osm_relation_id = staged.osm_relation_id`);
  await pool.query(`insert into osm.import_regions (id, name, country_code, download_url, source_version, status, imported_at)
    values ($1, $1, $2, $3, $1, 'importing', now())`, [regionId, countryCode, downloadUrl]);
  await pool.query(`insert into osm.boundaries (id, source_region_id, osm_relation_id, osm_version, name, admin_level, country_code, tags, geometry, geometry_3857, boundary_version, source_version)
    select 'relation/' || osm_relation_id, $1, osm_relation_id, osm_version, name, admin_level, $2, tags,
      gis.ST_Transform(gis.ST_Multi(geometry), 4326)::gis.geometry(MultiPolygon, 4326),
      gis.ST_Multi(geometry)::gis.geometry(MultiPolygon, 3857),
      md5(gis.ST_AsEWKB(gis.ST_Transform(geometry, 4326))), $1
    from osm_import.boundaries_stage where gis.ST_IsValid(geometry)`, [regionId, countryCode]);
  await pool.query(`insert into osm.roads (source_region_id, osm_way_id, road_type, tags, geometry, geometry_3857, source_version)
    select $1, osm_way_id, road_type, tags, gis.ST_Transform(geometry, 4326), geometry, $1
    from osm_import.roads_stage where gis.ST_IsValid(geometry)`, [regionId]);
  await pool.query(`update osm.import_regions set status = 'ready', imported_at = now(), updated_at = now() where id = $1`, [regionId]);
  await pool.query('commit');
  console.log(`Imported ${regionId} into the Roam OSM catalog.`);
} catch (error) {
  await pool.query('rollback');
  throw error;
} finally {
  await pool.end();
}
