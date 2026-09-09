import boundaries from './data/stockholm-districts.geo.json';

type Position = [number, number];
type Polygon = Position[][];
type Geometry = { type: 'Polygon'; coordinates: Polygon } | { type: 'MultiPolygon'; coordinates: Polygon[] };

export type StockholmDistrict = { id: string; name: string; geometry: Geometry };

function catalogId(name: string) {
  return `stockholm-${name.toLocaleLowerCase('sv-SE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}`;
}

function sortableDistrictName(name: string) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sv-SE');
}

export function compareDistrictNames(a: string, b: string) {
  const normalizedA = sortableDistrictName(a);
  const normalizedB = sortableDistrictName(b);
  if (normalizedA < normalizedB) return -1;
  if (normalizedA > normalizedB) return 1;
  return a.localeCompare(b, 'sv-SE');
}

export const STOCKHOLM_CATALOG_VERSION = 'stockholm-stadsdelar-2021-04-13';
export const STOCKHOLM_DISTRICTS: StockholmDistrict[] = (boundaries.features as unknown as Array<{ properties: { name: string }; geometry: Geometry }>)
  .map(feature => ({ id: catalogId(feature.properties.name), name: feature.properties.name, geometry: feature.geometry }))
  .sort((a, b) => compareDistrictNames(a.name, b.name));

function pointInRing([lng, lat]: Position, ring: Position[]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLng, currentLat] = ring[index];
    const [previousLng, previousLat] = ring[previous];
    const crosses = (currentLat > lat) !== (previousLat > lat)
      && lng < (previousLng - currentLng) * (lat - currentLat) / (previousLat - currentLat) + currentLng;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Position, polygon: Polygon) {
  return pointInRing(point, polygon[0]) && !polygon.slice(1).some(ring => pointInRing(point, ring));
}

export function findStockholmDistrict(point: Position) {
  return STOCKHOLM_DISTRICTS.find(district => district.geometry.type === 'Polygon'
    ? pointInPolygon(point, district.geometry.coordinates)
    : district.geometry.coordinates.some(polygon => pointInPolygon(point, polygon)));
}
