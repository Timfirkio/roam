import catalog from './data/road-network-stockholm.json';
import type { RoadType } from './discovery';

export type RoadNetworkDenominator = { segments: number; lengthMeters: number; byRoadType: Record<RoadType, { segments: number; lengthMeters: number }> };
export type RoadNetworkDistrict = { id: string; name: string; denominators: RoadNetworkDenominator };
export type RoadNetworkCatalog = { version: string; generatedAt: string; source: { provider: string; zoom: number; tileCount: number; tileTemplate: string }; coverage: { districtCount: number; districts: RoadNetworkDistrict[] }; segments: Array<{ id: string; roadType: RoadType }> };

export const STOCKHOLM_ROAD_NETWORK = catalog as RoadNetworkCatalog;
export const STOCKHOLM_ROAD_NETWORK_BY_DISTRICT = new Map(STOCKHOLM_ROAD_NETWORK.coverage.districts.map(district => [district.id, district]));
