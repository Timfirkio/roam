-- Apply this after updating a running PostGIS catalog. It keeps the public
-- vector tiles complete at municipal-region zoom without mixing overlapping
-- municipality and municipal-region boundaries.
create or replace function osm.boundary_tile(z integer, x integer, y integer)
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
      case
        when b.admin_level = 7 and not exists (
          select 1 from osm.boundaries child
          where child.source_region_id = b.source_region_id
            and child.admin_level = 9
            and gis.ST_Covers(b.geometry, gis.ST_PointOnSurface(child.geometry))
        ) then 9
        else b.admin_level
      end as display_level,
      b.country_code,
      gis.ST_AsMVTGeom(b.geometry_3857, tile_bounds.geom, 4096, 64, true) as geom
    from osm.boundaries b
    cross join tile_bounds
    where b.geometry_3857 && tile_bounds.geom
  )
  select coalesce(gis.ST_AsMVT(tile, 'boundaries', 4096, 'geom'), ''::bytea) from tile;
$$;
