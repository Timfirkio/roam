import type { RoadType } from './discovery';

export const UNPAVED_SURFACES = ['gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'unpaved', 'mud', 'sand', 'grass', 'woodchips', 'pebblestone', 'compacted'];
export const PATH_CLASSES = ['cycleway', 'path', 'pedestrian', 'footway', 'track', 'bridleway'];
export const LOCAL_STREET_CLASSES = ['minor', 'tertiary', 'secondary', 'residential', 'living_street', 'unclassified'];

export function roadTypeForProperties(properties: Record<string, unknown>): RoadType {
  const roadClass = String(properties.class ?? '');
  const subclass = String(properties.subclass ?? '');
  const surface = String(properties.surface ?? '');
  if (roadClass === 'cycleway' || subclass === 'cycleway') return 'cycleway';
  if (roadClass === 'footway' || roadClass === 'pedestrian') return 'footpath';
  if (PATH_CLASSES.includes(roadClass)) return UNPAVED_SURFACES.includes(surface) ? 'unpaved-path' : 'footpath';
  return 'paved-road';
}

export function isDiscoverableProperties(properties: Record<string, unknown>) {
  const roadClass = String(properties.class ?? '');
  const bicycle = String(properties.bicycle ?? '');
  const access = String(properties.access ?? '');
  const vehicle = String(properties.vehicle ?? '');
  const motorVehicle = String(properties.motor_vehicle ?? '');
  if (roadClass === 'parking_aisle' || roadClass === 'service' || bicycle === 'no' || access === 'no' || access === 'private' || vehicle === 'no' || motorVehicle === 'no') return false;
  if (PATH_CLASSES.includes(roadClass)) return ['yes', 'designated', 'permissive'].includes(bicycle) || ['yes', 'designated', 'permissive'].includes(String(properties.foot)) || roadClass === 'cycleway';
  return LOCAL_STREET_CLASSES.includes(roadClass);
}

export function stableRoadCandidateId(coordinates: [number, number][], roadType: RoadType) {
  const forward = coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const reverse = [...coordinates].reverse().map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const value = `${roadType}|${forward < reverse ? forward : reverse}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `road-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
