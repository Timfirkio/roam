import { createHash } from 'node:crypto';
import pg from 'pg';
import { administrativeLabel } from '../src/area-types.ts';
import { RULES_VERSION } from './area-network.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const emptyTotals = () => ({ lengthMeters: 0, byRoadType: { 'paved-road': 0, cycleway: 0, 'unpaved-path': 0 } });

function validPosition(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85.05112878) throw new Error('Choose a valid map location.');
}

/**
 * Read-only OSM catalog plus a small, resumable coverage queue. This is the
 * production replacement for the SQLite/Overpass area lookup service: every
 * response comes from the versioned PostGIS import, never a live OSM query.
 */
export class PostgisAreaService {
  constructor(connectionString, options = {}) {
    this.pool = options.pool ?? new pg.Pool({ connectionString, max: options.maxConnections ?? 8 });
    this.options = { rulesVersion: RULES_VERSION, ...options };
    this.active = false;
    this.closed = false;
    this.worker = null;
    this.catalog = true;
  }

  area(row, geometry = false) {
    return {
      id: row.id,
      name: row.name,
      adminLevel: Number(row.admin_level),
      countryCode: row.country_code,
      label: administrativeLabel(row.country_code, Number(row.admin_level)),
      boundaryVersion: row.boundary_version,
      geometry: geometry && row.geometry ? JSON.parse(row.geometry) : null,
    };
  }

  job(row) {
    if (!row) return null;
    return {
      id: row.id,
      areaId: row.area_id,
      boundaryVersion: row.boundary_version,
      networkVersion: row.source_version,
      rulesVersion: row.rules_version,
      status: row.status,
      completedTiles: row.status === 'ready' ? 1 : 0,
      totalTiles: 1,
      totals: row.totals,
      error: row.error,
      updatedAt: row.updated_at,
    };
  }

  async latestJob(area) {
    const { rows } = await this.pool.query(`
      select * from osm.coverage_jobs
      where area_id = $1 and boundary_version = $2 and source_version = $3 and rules_version = $4
      limit 1`, [area.id, area.boundaryVersion, area.sourceVersion, this.options.rulesVersion]);
    return this.job(rows[0]);
  }

  async record(row, geometry = false) {
    const area = this.area(row, geometry);
    area.sourceVersion = row.source_version;
    const job = await this.latestJob(area);
    delete area.sourceVersion;
    return { area, job, automatic: area.adminLevel >= 7 };
  }

  async lookup(lng, lat) {
    validPosition(lng, lat);
    const { rows } = await this.pool.query(`
      select id, name, admin_level, country_code, boundary_version, source_version
      from osm.boundaries
      where gis.ST_Covers(geometry, gis.ST_SetSRID(gis.ST_MakePoint($1, $2), 4326))
      order by admin_level asc, gis.ST_Area(geometry) desc`, [lng, lat]);
    return { areas: await Promise.all(rows.map(row => this.record(row))), source: 'Roam OSM catalog' };
  }

  async boundary(id) {
    const { rows } = await this.pool.query(`
      select id, name, admin_level, country_code, boundary_version, source_version, gis.ST_AsGeoJSON(geometry) as geometry
      from osm.boundaries where id = $1`, [id]);
    if (!rows[0]) throw new Error('This area is not in the imported OSM catalog yet.');
    return this.record(rows[0], true);
  }

  async search(query) {
    const normalized = String(query ?? '').trim().replace(/\s+/g, ' ');
    if (normalized.length < 2) return [];
    if (normalized.length > 120) throw new Error('Use a shorter location search.');
    const { rows } = await this.pool.query(`
      select id, name, admin_level, gis.ST_X(gis.ST_PointOnSurface(geometry)) as lng, gis.ST_Y(gis.ST_PointOnSurface(geometry)) as lat
      from osm.boundaries where name ilike $1
      order by admin_level desc, name asc limit 8`, [`%${normalized}%`]);
    return rows.map(row => ({ id: row.id, name: row.name, lng: Number(row.lng), lat: Number(row.lat), type: `Administrative level ${row.admin_level}` }));
  }

  async boundaryTile(z, x, y) {
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid map tile.');
    const { rows } = await this.pool.query('select osm.boundary_tile($1, $2, $3) as tile', [z, x, y]);
    return rows[0].tile;
  }

  async request(id, automatic = false) {
    if (!/^relation\/\d+$/.test(id)) throw new Error('Invalid area identifier.');
    const { rows } = await this.pool.query(`select id, name, admin_level, country_code, boundary_version, source_version from osm.boundaries where id = $1`, [id]);
    const areaRow = rows[0];
    if (!areaRow) throw new Error('This area is not in the imported OSM catalog yet.');
    const area = this.area(areaRow);
    const jobId = digest([area.id, area.boundaryVersion, areaRow.source_version, this.options.rulesVersion]);
    const existing = await this.latestJob({ ...area, sourceVersion: areaRow.source_version });
    if (existing && existing.status !== 'failed') return { area, job: existing, automatic: area.adminLevel >= 7 };
    if (automatic && area.adminLevel < 7) return { area, job: existing, automatic: false };
    await this.pool.query(`
      insert into osm.coverage_jobs (id, area_id, boundary_version, source_version, rules_version, status)
      values ($1, $2, $3, $4, $5, 'queued')
      on conflict (area_id, boundary_version, source_version, rules_version)
      do update set status = 'queued', error = null, totals = null, updated_at = now()`,
    [jobId, area.id, area.boundaryVersion, areaRow.source_version, this.options.rulesVersion]);
    this.kick();
    return { area, job: await this.latestJob({ ...area, sourceVersion: areaRow.source_version }), automatic: area.adminLevel >= 7 };
  }

  kick() {
    if (this.active || this.closed) return;
    this.active = true;
    this.worker = this.run().finally(() => { this.active = false; this.worker = null; });
  }

  async run() {
    while (!this.closed) {
      const { rows } = await this.pool.query(`
        update osm.coverage_jobs set status = 'running', updated_at = now()
        where id = (select id from osm.coverage_jobs where status = 'queued' order by created_at limit 1 for update skip locked)
        returning *`);
      const job = rows[0];
      if (!job) return;
      try {
        const measurements = await this.pool.query(`
          with clipped as (
            select r.road_type, gis.ST_CollectionExtract(gis.ST_Intersection(r.geometry_3857, b.geometry_3857), 2) as geometry
            from osm.roads r join osm.boundaries b on b.id = $1
            where r.source_region_id = b.source_region_id and gis.ST_Intersects(r.geometry_3857, b.geometry_3857)
          )
          select road_type, coalesce(sum(gis.ST_Length(geometry)), 0) as length_meters
          from clipped where not gis.ST_IsEmpty(geometry) group by road_type`, [job.area_id]);
        const totals = emptyTotals();
        for (const row of measurements.rows) totals.byRoadType[row.road_type] = Number(row.length_meters);
        totals.lengthMeters = Object.values(totals.byRoadType).reduce((sum, value) => sum + value, 0);
        await this.pool.query(`update osm.coverage_jobs set status = 'ready', totals = $2::jsonb, error = null, updated_at = now() where id = $1`, [job.id, JSON.stringify(totals)]);
      } catch (error) {
        await this.pool.query(`update osm.coverage_jobs set status = 'failed', error = $2, updated_at = now() where id = $1`, [job.id, error instanceof Error ? error.message : 'Coverage calculation failed.']);
      }
    }
  }

  async close() { this.closed = true; await this.worker; await this.pool.end?.(); }
}
