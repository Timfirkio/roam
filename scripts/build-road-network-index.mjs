import fs from 'node:fs/promises';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { booleanIntersects, feature, lineChunk, lineString, length } from '@turf/turf';

const ROOT = path.resolve(import.meta.dirname, '..');
const ZOOM = 14;
const CHUNK_METERS = 12;
const SOURCE_CATALOG = 'openfreemap-planet';
const CATALOG_VERSION = 'road-network-stockholm-2026-09-10-v2';
const UNPAVED_SURFACES = ['gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'unpaved', 'mud', 'sand', 'grass', 'woodchips', 'pebblestone', 'compacted'];
const PATH_CLASSES = ['cycleway', 'path', 'pedestrian', 'footway', 'track', 'bridleway'];
const LOCAL_STREET_CLASSES = ['minor', 'tertiary', 'secondary', 'residential', 'living_street', 'unclassified'];

function roadType(properties) {
  const roadClass = String(properties.class ?? '');
  const subclass = String(properties.subclass ?? '');
  const surface = String(properties.surface ?? '');
  if (roadClass === 'cycleway' || subclass === 'cycleway') return 'cycleway';
  if (roadClass === 'footway' || roadClass === 'pedestrian') return 'footpath';
  if (PATH_CLASSES.includes(roadClass)) return UNPAVED_SURFACES.includes(surface) ? 'unpaved-path' : 'footpath';
  return 'paved-road';
}
function eligible(properties) {
  const roadClass = String(properties.class ?? '');
  const bicycle = String(properties.bicycle ?? '');
  const access = String(properties.access ?? '');
  const vehicle = String(properties.vehicle ?? '');
  const motorVehicle = String(properties.motor_vehicle ?? '');
  if (roadClass === 'parking_aisle' || roadClass === 'service' || bicycle === 'no' || access === 'no' || access === 'private' || vehicle === 'no' || motorVehicle === 'no') return false;
  if (PATH_CLASSES.includes(roadClass)) return ['yes', 'designated', 'permissive'].includes(bicycle) || ['yes', 'designated', 'permissive'].includes(String(properties.foot)) || roadClass === 'cycleway';
  return LOCAL_STREET_CLASSES.includes(roadClass);
}
function stableId(coordinates, type) {
  const forward = coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const reverse = [...coordinates].reverse().map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const value = `${type}|${forward < reverse ? forward : reverse}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `road-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function catalogId(name) {
  return `stockholm-${name.toLocaleLowerCase('sv-SE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}
function tileXY(lng, lat) {
  const n = 2 ** ZOOM;
  return [Math.floor((lng + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)];
}
function bbox(geometry) {
  const points = geometry.type === 'Polygon'
    ? geometry.coordinates.flat()
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates.flat(2)
      : geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.coordinates.flat();
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
}
function boundsOverlap(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }
function geometryKey(coordinates) { return coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';'); }

const metadata = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const tileTemplate = metadata.tiles[0];
const boundaries = JSON.parse(await fs.readFile(path.join(ROOT, 'src/data/stockholm-districts.geo.json'), 'utf8'));
const districts = boundaries.features.map(feature => ({ id: catalogId(feature.properties.name), name: feature.properties.name, geometry: feature.geometry }));
if (!districts.length) throw new Error('Could not resolve any districts from the official boundary catalog');

const tiles = new Map();
for (const district of districts) {
  const [minLng, minLat, maxLng, maxLat] = bbox(district.geometry);
  const [minX, maxY] = tileXY(minLng, minLat);
  const [maxX, minY] = tileXY(maxLng, maxLat);
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) tiles.set(`${x}/${y}`, [x, y]);
}

const roads = new Map();
for (const [key, [x, y]] of tiles) {
  const url = tileTemplate.replace('{z}', ZOOM).replace('{x}', x).replace('{y}', y);
  const bytes = await (await fetch(url)).arrayBuffer();
  const layer = new VectorTile(new PbfReader(bytes)).layers.transportation;
  for (let index = 0; index < (layer?.length ?? 0); index++) {
    const tileFeature = layer.feature(index);
    const properties = tileFeature.properties ?? {};
    if (!eligible(properties)) continue;
    const geometry = tileFeature.toGeoJSON(x, y, ZOOM).geometry;
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
    for (const coordinates of lines) {
      if (coordinates.length < 2) continue;
      const type = roadType(properties);
      const id = stableId(coordinates, type);
      roads.set(`${id}:${geometryKey(coordinates)}`, { id, type, coordinates });
    }
  }
  process.stdout.write(`indexed tile ${key} (${roads.size} candidate geometries)\n`);
}

const segments = [];
for (const road of roads.values()) {
  const chunks = lineChunk(lineString(road.coordinates), CHUNK_METERS / 1000, { units: 'kilometers' }).features;
  chunks.forEach((chunk, index) => segments.push({ id: `${road.id}:${index}`, roadType: road.type, geometry: chunk.geometry, lengthMeters: Math.round(length(chunk, { units: 'kilometers' }) * 1000) }));
}
const districtBoundaries = districts.map(district => ({ id: district.id, feature: feature(district.geometry), bounds: bbox(district.geometry) }));
const indexedSegments = segments.filter(segment => {
  const segmentBounds = bbox(segment.geometry);
  return districtBoundaries.some(boundary => boundsOverlap(segmentBounds, boundary.bounds) && booleanIntersects(feature(segment.geometry), boundary.feature));
});
const districtEntries = districts.map(district => {
  const boundary = districtBoundaries.find(candidate => candidate.id === district.id).feature;
  const boundaryBounds = bbox(district.geometry);
  const included = indexedSegments.filter(segment => boundsOverlap(bbox(segment.geometry), boundaryBounds) && booleanIntersects(feature(segment.geometry), boundary));
  const byType = Object.fromEntries(['paved-road', 'cycleway', 'unpaved-path', 'footpath'].map(type => {
    const typed = included.filter(segment => segment.roadType === type);
    return [type, { segments: typed.length, lengthMeters: typed.reduce((sum, segment) => sum + segment.lengthMeters, 0) }];
  }));
  return { id: district.id, name: district.name, denominators: { segments: included.length, lengthMeters: included.reduce((sum, segment) => sum + segment.lengthMeters, 0), byRoadType: byType } };
});
// Geometry and segment IDs are deliberately not copied into the app bundle.
// The client discovers against the detailed network tiles; this manifest only
// supplies denominators for progress bars.
const output = { version: CATALOG_VERSION, generatedAt: new Date().toISOString(), source: { provider: SOURCE_CATALOG, zoom: ZOOM, tileCount: tiles.size, tileTemplate }, coverage: { districtCount: districtEntries.length, districts: districtEntries } };
await fs.writeFile(path.join(ROOT, 'src/data/road-network-stockholm.json'), `${JSON.stringify(output)}\n`);
console.log(`wrote ${indexedSegments.length} segments for ${districtEntries.length} districts from ${tiles.size} z${ZOOM} tiles`);
