import hierarchy from './data/stockholm-hierarchy.json';
import { STOCKHOLM_DISTRICTS, type StockholmDistrict } from './stockholm-catalog';

export type StockholmRegion = {
  id: string;
  name: string;
  districts: StockholmDistrict[];
};

function resolveDistrict(id: string) {
  const district = STOCKHOLM_DISTRICTS.find(candidate => candidate.id === id);
  if (!district) throw new Error(`Stockholm hierarchy references unknown district: ${id}`);
  return district;
}

export const STOCKHOLM_MUNICIPALITY = hierarchy.municipality;
export const STOCKHOLM_REGIONS: StockholmRegion[] = hierarchy.regions.map(region => ({
  id: region.id,
  name: region.name,
  districts: region.districtIds.map(resolveDistrict),
}));

export const STOCKHOLM_REGION_BY_DISTRICT = new Map(
  STOCKHOLM_REGIONS.flatMap(region => region.districts.map(district => [district.id, region] as const)),
);

if (STOCKHOLM_REGION_BY_DISTRICT.size !== STOCKHOLM_DISTRICTS.length || STOCKHOLM_REGIONS.reduce((count, region) => count + region.districts.length, 0) !== STOCKHOLM_DISTRICTS.length) {
  throw new Error('Stockholm hierarchy must assign every district to exactly one region');
}
