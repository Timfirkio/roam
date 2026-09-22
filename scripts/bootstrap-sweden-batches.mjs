import pg from 'pg';

const databaseUrl = process.env.AREA_DATABASE_URL;
const reset = process.argv.includes('--reset');
if (!databaseUrl) throw new Error('AREA_DATABASE_URL is required.');

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await pool.query(`
    create table if not exists osm.sweden_batches (
      area_id text primary key references osm.boundaries(id) on delete cascade,
      source_region_id text not null unique,
      name text not null,
      status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'failed')),
      error text,
      started_at timestamptz,
      completed_at timestamptz,
      updated_at timestamptz not null default now()
    )`);
  if (reset) await pool.query('delete from osm.sweden_batches');
  const { rowCount } = await pool.query(`
    insert into osm.sweden_batches (area_id, source_region_id, name)
    select b.id,
      case when b.id = 'relation/54391' then 'stockholm-county' else 'sweden-lan-' || b.osm_relation_id end,
      b.name
    from osm.boundaries b
    where b.country_code = 'SE' and b.admin_level = 4
    on conflict (area_id) do update set name = excluded.name, updated_at = now()`);
  const { rows } = await pool.query(`
    select status, count(*)::integer as count
    from osm.sweden_batches group by status order by status`);
  console.log(`Prepared ${rowCount} Sweden county batches.`);
  console.table(rows);
} finally {
  await pool.end();
}
