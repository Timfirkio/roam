-- Flex output for the Roam catalog importer. It intentionally keeps only the
-- objects used for administrative coverage; styles, POIs and routable graph
-- metadata do not belong in this database.
local unpaved = {
  gravel = true, fine_gravel = true, dirt = true, earth = true, ground = true,
  unpaved = true, mud = true, sand = true, grass = true, woodchips = true,
  pebblestone = true, compacted = true,
}
local path_classes = { cycleway = true, path = true, pedestrian = true, footway = true, track = true, bridleway = true }
local local_streets = { tertiary = true, secondary = true, residential = true, living_street = true, unclassified = true }

local boundaries = osm2pgsql.define_table({
  name = 'boundaries_stage', schema = 'osm_import', ids = { type = 'any', id_column = 'source_id' },
  columns = {
    { column = 'osm_relation_id', type = 'int8', not_null = true },
    { column = 'osm_version', type = 'int8', not_null = true },
    { column = 'name', type = 'text', not_null = true },
    { column = 'admin_level', type = 'int4', not_null = true },
    { column = 'tags', type = 'jsonb', not_null = true },
    -- osm2pgsql's native Flex projection is Web Mercator. Keep staging in
    -- that projection and convert once inside the catalog transaction.
    { column = 'geometry', type = 'multipolygon', projection = 3857, not_null = true },
  },
})

local roads = osm2pgsql.define_table({
  name = 'roads_stage', schema = 'osm_import', ids = { type = 'way', id_column = 'source_id' },
  columns = {
    { column = 'osm_way_id', type = 'int8', not_null = true },
    { column = 'road_type', type = 'text', not_null = true },
    { column = 'tags', type = 'jsonb', not_null = true },
    { column = 'geometry', type = 'linestring', projection = 3857, not_null = true },
  },
})

local function denied(tags)
  return tags.bicycle == 'no' or tags.access == 'no' or tags.access == 'private' or tags.vehicle == 'no' or tags.motor_vehicle == 'no'
end

local function road_type(tags)
  if unpaved[tags.surface] and path_classes[tags.highway] then return 'unpaved-path' end
  if tags.highway == 'cycleway' or tags.cycleway then return 'cycleway' end
  if path_classes[tags.highway] then return 'cycleway' end
  return 'paved-road'
end

local function discoverable(tags)
  local highway = tags.highway
  if not highway or highway == 'service' or denied(tags) then return false end
  if path_classes[highway] then
    return highway == 'cycleway' or tags.bicycle == 'yes' or tags.bicycle == 'designated' or tags.bicycle == 'permissive' or tags.foot == 'yes' or tags.foot == 'designated' or tags.foot == 'permissive'
  end
  return local_streets[highway] == true
end

function osm2pgsql.process_relation(object)
  local tags = object.tags
  local level = tonumber(tags.admin_level)
  if tags.boundary == 'administrative' and tags.name and level and level >= 2 and level <= 11 then
    local geometry = object:as_multipolygon():transform(3857)
    if geometry then
      boundaries:insert({ osm_relation_id = object.id, osm_version = object.version, name = tags.name, admin_level = level, tags = tags, geometry = geometry })
    end
  end
end

function osm2pgsql.process_way(object)
  if discoverable(object.tags) then
    local geometry = object:as_linestring():transform(3857)
    if geometry then
      roads:insert({ osm_way_id = object.id, road_type = road_type(object.tags), tags = object.tags, geometry = geometry })
    end
  end
end
