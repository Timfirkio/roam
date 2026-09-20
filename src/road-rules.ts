import type { RoadType } from './discovery';

export const UNPAVED_SURFACES = ['gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'unpaved', 'mud', 'sand', 'grass', 'woodchips', 'pebblestone', 'compacted'];
export const PATH_CLASSES = ['cycleway', 'path', 'pedestrian', 'footway', 'track', 'bridleway'];
export const LOCAL_STREET_CLASSES = ['minor', 'tertiary', 'secondary', 'residential', 'living_street', 'unclassified'];

/**
 * Keeps segment IDs stable across presentation-category changes. It mirrors
 * the category names used before the three-category progress update.
 */
export function legacyRoadTypeForProperties(properties: Record<string, unknown>) {
  const roadClass = String(properties.class ?? '');
  const subclass = String(properties.subclass ?? '');
  const surface = String(properties.surface ?? '');
  if (roadClass === 'cycleway' || subclass === 'cycleway') return 'cycleway';
  if (roadClass === 'footway' || roadClass === 'pedestrian') return 'footpath';
  if (PATH_CLASSES.includes(roadClass)) return UNPAVED_SURFACES.includes(surface) ? 'unpaved-path' : 'footpath';
  return 'paved-road';
}

export function roadTypeForProperties(properties: Record<string, unknown>): RoadType {
  const roadClass = String(properties.class ?? '');
  const subclass = String(properties.subclass ?? '');
  const surface = String(properties.surface ?? '');
  // Surface takes precedence for paths: an unpaved cycleway belongs with the
  // orange paths rather than the teal paved-cycleway category.
  if (UNPAVED_SURFACES.includes(surface) && (PATH_CLASSES.includes(roadClass) || subclass === 'cycleway')) return 'unpaved-path';
  if (roadClass === 'cycleway' || subclass === 'cycleway') return 'cycleway';
  // Paved or untagged bike-friendly paths are represented as cycleways: they
  // are separated from motor traffic even when OpenStreetMap calls them paths.
  if (PATH_CLASSES.includes(roadClass)) return 'cycleway';
  return 'paved-road';
}

export function isDiscoverableProperties(properties: Record<string, unknown>) {
  const roadClass = String(properties.class ?? '');
  const subclass = String(properties.subclass ?? '');
  const bicycle = String(properties.bicycle ?? '');
  const access = String(properties.access ?? '');
  const vehicle = String(properties.vehicle ?? '');
  const motorVehicle = String(properties.motor_vehicle ?? '');
  if (roadClass === 'parking_aisle' || roadClass === 'service' || bicycle === 'no' || access === 'no' || access === 'private' || vehicle === 'no' || motorVehicle === 'no') return false;
  // OpenFreeMap represents OSM highway=cycleway as class=path and
  // subclass=cycleway. Treat either representation as inherently bikeable,
  // while preserving the explicit access denials above.
  if (PATH_CLASSES.includes(roadClass)) return ['yes', 'designated', 'permissive'].includes(bicycle) || ['yes', 'designated', 'permissive'].includes(String(properties.foot)) || roadClass === 'cycleway' || subclass === 'cycleway';
  return LOCAL_STREET_CLASSES.includes(roadClass);
}

export function stableRoadCandidateId(coordinates: [number, number][], roadType: RoadType, identityType: string = roadType) {
  const forward = coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const reverse = [...coordinates].reverse().map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const value = `${identityType}|${forward < reverse ? forward : reverse}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `road-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
