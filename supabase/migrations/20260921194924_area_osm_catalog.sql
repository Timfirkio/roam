-- OSM is imported by a dedicated database role into this private catalog. The
-- application only reads it through the authenticated area service; raw map
-- tables are deliberately outside the Data API's public schema.
create schema if not exists gis;
create extension if not exists postgis with schema gis;
create schema if not exists osm;
create schema if not exists osm_import;

revoke all on schema osm from public, anon, authenticated;
revoke all on schema osm_import from public, anon, authenticated;

create table osm.import_regions (
  id text primary key,
  name text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  download_url text not null,
  source_version text not null,
  osm_updated_at timestamptz,
  imported_at timestamptz,
  status text not null default 'queued' check (status in ('queued', 'downloading', 'importing', 'ready', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table osm.boundaries (
  id text primary key check (id ~ '^relation/[0-9]+$'),
  source_region_id text not null references osm.import_regions(id) on delete cascade,
  osm_relation_id bigint not null,
  osm_version bigint not null,
  name text not null,
  admin_level smallint not null check (admin_level between 2 and 11),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  tags jsonb not null default '{}'::jsonb,
  geometry gis.geometry(MultiPolygon, 4326) not null,
  geometry_3857 gis.geometry(MultiPolygon, 3857) not null,
  boundary_version text not null,
  source_version text not null,
  imported_at timestamptz not null default now(),
  unique (source_region_id, osm_relation_id)
);

create index boundaries_geometry_idx on osm.boundaries using gist (geometry);
create index boundaries_geometry_3857_idx on osm.boundaries using gist (geometry_3857);
create index boundaries_level_idx on osm.boundaries (country_code, admin_level, name);

create table osm.roads (
  id bigint generated always as identity primary key,
  source_region_id text not null references osm.import_regions(id) on delete cascade,
  osm_way_id bigint not null,
  road_type text not null check (road_type in ('paved-road', 'cycleway', 'unpaved-path')),
  tags jsonb not null default '{}'::jsonb,
  geometry gis.geometry(LineString, 4326) not null,
  geometry_3857 gis.geometry(LineString, 3857) not null,
  source_version text not null,
  unique (source_region_id, osm_way_id)
);

create index roads_geometry_idx on osm.roads using gist (geometry);
create index roads_geometry_3857_idx on osm.roads using gist (geometry_3857);
create index roads_region_type_idx on osm.roads (source_region_id, road_type);

create table osm.coverage_jobs (
  id text primary key,
  area_id text not null references osm.boundaries(id) on delete cascade,
  boundary_version text not null,
  source_version text not null,
  rules_version text not null,
  status text not null check (status in ('queued', 'running', 'ready', 'failed')),
  totals jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (area_id, boundary_version, source_version, rules_version)
);

create index coverage_jobs_queue_idx on osm.coverage_jobs (status, created_at) where status in ('queued', 'running');

-- MapLibre consumes viewport boundaries as MVT. The geometry is clipped in the
-- database, so a pan needs one cheap indexed tile request rather than a chain
-- of third-party relation lookups.
create function osm.boundary_tile(z integer, x integer, y integer)
returns bytea
language sql
stable
security invoker
set search_path = pg_catalog, gis, osm
as $$
  with tile_bounds as (
    select gis.ST_TileEnvelope(z, x, y) as geom
  ), tile as (
    select
      b.id,
      b.name,
      b.admin_level,
      b.country_code,
      gis.ST_AsMVTGeom(b.geometry_3857, tile_bounds.geom, 4096, 64, true) as geom
    from osm.boundaries b
    cross join tile_bounds
    where b.geometry_3857 && tile_bounds.geom
  )
  select coalesce(gis.ST_AsMVT(tile, 'boundaries', 4096, 'geom'), ''::bytea) from tile;
$$;

alter table osm.import_regions enable row level security;
alter table osm.boundaries enable row level security;
alter table osm.roads enable row level security;
alter table osm.coverage_jobs enable row level security;

create policy "No direct catalog API access" on osm.import_regions as restrictive for all to anon, authenticated using (false) with check (false);
create policy "No direct catalog API access" on osm.boundaries as restrictive for all to anon, authenticated using (false) with check (false);
create policy "No direct catalog API access" on osm.roads as restrictive for all to anon, authenticated using (false) with check (false);
create policy "No direct catalog API access" on osm.coverage_jobs as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on all tables in schema osm from public, anon, authenticated;
revoke all on function osm.boundary_tile(integer, integer, integer) from public, anon, authenticated;
