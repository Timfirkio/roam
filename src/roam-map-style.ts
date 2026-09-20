import type { Map } from 'maplibre-gl';

export const ROAM_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const ROAD_MIN_ZOOM = 6;
const ROAD_MAX_ZOOM = 24;
const UNPAVED_SURFACES = ['gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'unpaved', 'mud', 'sand', 'grass', 'woodchips', 'pebblestone', 'compacted'];
const PATH_CLASSES = ['cycleway', 'path', 'pedestrian', 'footway', 'track', 'bridleway'];
const NON_BIKEABLE_ROAD_CLASSES = ['motorway', 'trunk', 'primary'];
const explicitBikeAccessFeature = ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false] as any;
const nonBikeableRoadFeature = ['all', ['!', ['match', ['get', 'class'], PATH_CLASSES, true, false]], ['!', explicitBikeAccessFeature], ['any', ['match', ['get', 'class'], NON_BIKEABLE_ROAD_CLASSES, true, false], ['match', ['get', 'subclass'], ['link'], true, false], ['match', ['get', 'bicycle'], ['no'], true, false], ['match', ['get', 'access'], ['no', 'private'], true, false], ['match', ['get', 'vehicle'], ['no'], true, false], ['match', ['get', 'motor_vehicle'], ['no'], true, false]]] as any;
const surfaceColor = (pavedColor: string, unpavedColor: string) => ['match', ['get', 'surface'], UNPAVED_SURFACES, unpavedColor, pavedColor] as any;
const cyclewayFeature = ['any', ['match', ['get', 'class'], ['cycleway'], true, false], ['match', ['get', 'subclass'], ['cycleway'], true, false]] as any;
const discoveryAccessDeniedFeature = ['any', ['match', ['get', 'bicycle'], ['no'], true, false], ['match', ['get', 'access'], ['no', 'private'], true, false], ['match', ['get', 'vehicle'], ['no'], true, false], ['match', ['get', 'motor_vehicle'], ['no'], true, false]] as any;
const pathAccessFeature = ['all', ['!', discoveryAccessDeniedFeature], ['any', cyclewayFeature, ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false], ['match', ['get', 'foot'], ['yes', 'designated', 'permissive'], true, false]]] as any;
const bikeablePathFeature = ['all', ['match', ['get', 'class'], PATH_CLASSES, true, false], pathAccessFeature] as any;
const unpavedBikeablePathFeature = ['all', bikeablePathFeature, ['match', ['get', 'surface'], UNPAVED_SURFACES, true, false]] as any;
const bikeablePathFilter = ['all', ['!', nonBikeableRoadFeature], ['!=', ['get', 'class'], 'parking_aisle'], ['!=', ['get', 'class'], 'service'], ['match', ['get', 'class'], PATH_CLASSES, true, false], pathAccessFeature] as any;

/** The shared flat visual treatment for both the interactive map and thumbnails. */
export function applyRoamBaseStyle(map: Map) {
  const layers = map.getStyle().layers ?? [];
  map.setPaintProperty('background', 'background-color', '#0a0b0c');
  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    const sourceLayer = 'source-layer' in layer && typeof layer['source-layer'] === 'string' ? layer['source-layer'].toLowerCase() : '';
    const isRoamOverlay = id.startsWith('roam-');
    const isRoad = !isRoamOverlay && (id.includes('transportation') || sourceLayer === 'transportation');
    const isRail = /rail/.test(id) || /(^|_)transit(_|$)/.test(id);
    const isHighway = /motorway|trunk|primary|secondary/.test(id);
    const isWater = id.includes('water') || sourceLayer === 'water';
    const isPark = /park|wood|forest|grass|meadow|cemetery|recreation|garden|landcover/.test(id) || /landcover|landuse/.test(sourceLayer);
    const isRestricted = /military|aeroway|airport|airfield/.test(id) || /military|aeroway/.test(sourceLayer);
    if (layer.type === 'symbol' || id.includes('building') || id.includes('boundary') || id === 'park_outline' || id === 'landcover_wetland' || id === 'road_area_pattern' || isRail || (isRestricted && layer.type === 'line')) map.setLayoutProperty(layer.id, 'visibility', 'none');
    if (layer.type === 'fill' && isWater) { map.setPaintProperty(layer.id, 'fill-color', '#102331'); map.setPaintProperty(layer.id, 'fill-opacity', .92); }
    if (layer.type === 'fill' && isPark) { map.setPaintProperty(layer.id, 'fill-color', '#0e1b17'); map.setPaintProperty(layer.id, 'fill-opacity', .86); if (id === 'park') map.setPaintProperty(layer.id, 'fill-outline-color', '#13251f'); }
    if (layer.type === 'fill' && isRestricted) { map.setPaintProperty(layer.id, 'fill-color', '#241216'); map.setPaintProperty(layer.id, 'fill-opacity', .9); map.setPaintProperty(layer.id, 'fill-outline-color', '#241216'); }
    if (layer.type === 'line' && isWater) { map.setPaintProperty(layer.id, 'line-color', '#24465a'); map.setPaintProperty(layer.id, 'line-opacity', .8); }
    if (layer.type === 'line' && isRestricted) { map.setPaintProperty(layer.id, 'line-color', '#6b3038'); map.setPaintProperty(layer.id, 'line-opacity', .85); }
    if (isRoad && layer.type === 'line') {
      const isCycleway = /cycleway/.test(id);
      const isPedestrianFootpath = /footway|pedestrian/.test(id);
      const isGravelPath = /track|path|bridleway/.test(id) && !isPedestrianFootpath && !isCycleway;
      const isPath = isCycleway || isPedestrianFootpath || isGravelPath;
      const isMajor = /motorway|trunk|primary/.test(id);
      map.setLayerZoomRange(layer.id, ROAD_MIN_ZOOM, ROAD_MAX_ZOOM);
      const existingFilter = 'filter' in layer ? layer.filter : undefined;
      map.setFilter(layer.id, ['all', ...(existingFilter ? [existingFilter] : []), ['!=', ['get', 'class'], 'parking_aisle'], ['!=', ['get', 'class'], 'service'], ...(isPath ? [bikeablePathFeature] : [])] as any);
      map.setPaintProperty(layer.id, 'line-color', ['case', nonBikeableRoadFeature, '#28161a', isHighway, '#333a38', unpavedBikeablePathFeature, '#4f3c2b', cyclewayFeature, '#154644', bikeablePathFeature, '#154644', surfaceColor('#2d3331', '#3a2e23')]);
      map.setPaintProperty(layer.id, 'line-opacity', isPedestrianFootpath ? 0 : 1);
      map.setPaintProperty(layer.id, 'line-width', isMajor ? ['interpolate', ['linear'], ['zoom'], 6, .9, 10, 1.1, 14, 4.5, 18, 7] : isPath ? ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 14, 2.4, 18, 3] : ['interpolate', ['linear'], ['zoom'], 6, .75, 10, .95, 14, 3, 18, 4]);
      map.setLayoutProperty(layer.id, 'line-cap', 'round'); map.setLayoutProperty(layer.id, 'line-join', 'round');
      if (isPedestrianFootpath) map.setPaintProperty(layer.id, 'line-dasharray', [1, 2.5]); else if (isCycleway || isGravelPath || isHighway) map.setPaintProperty(layer.id, 'line-dasharray', null);
    }
  }
  if (map.getSource('openmaptiles') && !map.getLayer('roam-bikeable-paths')) map.addLayer({ id: 'roam-bikeable-paths', type: 'line', minzoom: ROAD_MIN_ZOOM, maxzoom: ROAD_MAX_ZOOM, source: 'openmaptiles', 'source-layer': 'transportation', filter: bikeablePathFilter, paint: { 'line-color': ['case', unpavedBikeablePathFeature, '#4f3c2b', cyclewayFeature, '#154644', bikeablePathFeature, '#154644', surfaceColor('#2d3331', '#3a2e23')], 'line-opacity': 1, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 14, 2.4, 18, 3] } } as any);
}
