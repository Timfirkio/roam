import { StrictMode, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { type Map } from 'maplibre-gl';
import { circle } from '@turf/turf';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { installNetworkSource, NETWORK_SOURCE } from './network-source';
import { NETWORK_MIN_ZOOM } from './network-tiles';
import { DISCOVERY_RADIUS_METERS, discoverSegments, type DiscoveredSegment, type RoadCandidate } from './discovery';
import { loadDiscoveredSegments, saveDiscoveredSegments } from './discovery-store';
import { findStockholmDistrict, STOCKHOLM_DISTRICTS } from './stockholm-catalog';
import { nextNavigationState, type NavigationState } from './player-navigation';
import { Geolocation, type CallbackID, type Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { RideTracking } from './ride-background-tracking';
import { isDiscoverableProperties, roadTypeForProperties, stableRoadCandidateId } from './road-rules';
import { STOCKHOLM_ROAD_NETWORK_BY_DISTRICT } from './road-network-catalog';
import { Button as ShadcnButton } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs as ShadcnTabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { useScreenWakeLock } from './use-screen-wake-lock';
import { Bug, ChartBar, CrosshairSimple, Gear, MapTrifold, Minus, Plus, RoadHorizon } from '@phosphor-icons/react';

type View = 'map' | 'sessions' | 'progress' | 'settings' | 'design-system';
type LocationState = { city: string; region: string; lng: number; lat: number };
type GpsPermission = 'prompt' | 'granted' | 'denied';
type PlayerLocation = NavigationState & { accuracy: number };

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const TERRAIN_SOURCE = 'roam-terrain';
const HILLSHADE_SOURCE = 'roam-hillshade';
const TERRAIN_TILEJSON = 'https://tiles.mapterhorn.com/tilejson.json';
const TERRAIN_LOD_LEVELS = 2;
const TERRAIN_TILE_RATIO = 1.5;
const TERRAIN_EXAGGERATION = 1.05;
const ROAD_MIN_ZOOM = 6;
const ROAD_MAX_ZOOM = 24;
const DEFAULT_MAP_ZOOM = 15;
const DEFAULT_3D_PITCH = 60;
const MAX_MAP_PITCH = 64;
const UNPAVED_SURFACES = ['gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'unpaved', 'mud', 'sand', 'grass', 'woodchips', 'pebblestone', 'compacted'];
const PATH_CLASSES = ['cycleway', 'path', 'pedestrian', 'footway', 'track', 'bridleway'];
const LOCAL_STREET_CLASSES = ['minor', 'tertiary', 'secondary', 'residential', 'living_street', 'unclassified'];
const NON_BIKEABLE_ROAD_CLASSES = ['motorway', 'trunk', 'primary'];
const explicitBikeAccessFeature = ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false] as any;
const nonBikeableRoadFeature = ['all', ['!', ['match', ['get', 'class'], PATH_CLASSES, true, false]], ['!', explicitBikeAccessFeature], ['any', ['match', ['get', 'class'], NON_BIKEABLE_ROAD_CLASSES, true, false], ['match', ['get', 'subclass'], ['link'], true, false], ['match', ['get', 'bicycle'], ['no'], true, false], ['match', ['get', 'access'], ['no', 'private'], true, false], ['match', ['get', 'vehicle'], ['no'], true, false], ['match', ['get', 'motor_vehicle'], ['no'], true, false]]] as any;
const DEFAULT_LOCATION: LocationState = { city: 'STOCKHOLM', region: 'SÖDERMALM', lng: 18.0649, lat: 59.3326 };
const GPS_ENABLED_STORAGE_KEY = 'roam.gps.enabled';
const GPS_PERMISSION_STORAGE_KEY = 'roam.gps.permission';
const DISTRICT_BOUNDARIES_STORAGE_KEY = 'roam.district-boundaries.visible';
const LAST_MAP_CENTER_STORAGE_KEY = 'roam.map.last-center';
const DISCOVERED_SOURCE = 'roam-discovered-network';
const DISTRICT_BOUNDARIES_SOURCE = 'roam-district-boundaries';
const DISTRICT_BOUNDARIES_FILL = 'roam-district-boundaries-fill';
const DISTRICT_BOUNDARIES_LINE = 'roam-district-boundaries-line';
const PLAYER_DISCOVERY_SOURCE = 'roam-player-discovery-radius';
const PLAYER_DISCOVERY_FILL = 'roam-player-discovery-radius-fill';
const PLAYER_DISCOVERY_LINE = 'roam-player-discovery-radius-line';

const surfaceColor = (pavedColor: string, unpavedColor: string) =>
  ['match', ['get', 'surface'], UNPAVED_SURFACES, unpavedColor, pavedColor] as any;

const cyclewayFeature = ['any', ['match', ['get', 'class'], ['cycleway'], true, false], ['match', ['get', 'subclass'], ['cycleway'], true, false]] as any;
const pathAccessFeature = ['any', cyclewayFeature, ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false], ['match', ['get', 'foot'], ['yes', 'designated', 'permissive'], true, false]] as any;
const networkExclusionFilter = ['all', ['!', nonBikeableRoadFeature], ['!=', ['get', 'class'], 'parking_aisle'], ['!=', ['get', 'class'], 'service']] as any;
const bikeablePathEligibilityFilter = ['all', ['match', ['get', 'class'], PATH_CLASSES, true, false], pathAccessFeature] as any;
const localRoadEligibilityFilter = ['all', ['match', ['get', 'class'], LOCAL_STREET_CLASSES, true, false], ['!=', ['get', 'bicycle'], 'no']] as any;
const bikeablePathFilter = ['all', networkExclusionFilter, bikeablePathEligibilityFilter] as any;

type ProgressStats = {
  discovered: number;
  pavedBikeableRoads: number;
  pavedCycleways: number;
  unpavedPaths: number;
  footpaths: number;
};

const CURRENT_PROGRESS: ProgressStats = { discovered: 0, pavedBikeableRoads: 0, pavedCycleways: 0, unpavedPaths: 0, footpaths: 0 };

function formatDistance(meters: number) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function bikeableLengthMeters(denominator: { byRoadType: Record<string, { lengthMeters: number }> }) {
  return ['paved-road', 'cycleway', 'unpaved-path'].reduce((total, type) => total + (denominator.byRoadType[type]?.lengthMeters ?? 0), 0);
}

function bikeableDiscoveredMeters(discoveries: DiscoveredSegment[]) {
  return discoveries.filter(segment => segment.roadType !== 'footpath').reduce((total, segment) => total + segment.lengthMeters, 0);
}

function ProgressBar({ stats, className = '' }: { stats: ProgressStats; className?: string }) {
  return <div className={`progress-bar ${className}`}><i className="progress-bar__discovered" style={{ width: `${stats.discovered}%` }}><em className="progress-bar__paved-roads" style={{ width: `${stats.pavedBikeableRoads}%` }} /><em className="progress-bar__paved-cycleways" style={{ width: `${stats.pavedCycleways}%` }} /><em className="progress-bar__unpaved" style={{ width: `${stats.unpavedPaths}%` }} /><em className="progress-bar__footpaths" style={{ width: `${stats.footpaths}%` }} /></i></div>;
}

function DistrictProgressContent({ title, distance, percentage, stats }: { title: ReactNode; distance: string; percentage: string; stats: ProgressStats }) {
  return <div className="district-progress-content"><div className="district-progress-top"><div className="district-progress-title">{title}</div><div className="district-progress-percent">{percentage}</div></div><div className="district-progress-description">{distance}</div><ProgressBar stats={stats} />
  </div>;
}

function styleRoamMap(map: Map, showDiscovered: boolean, showDistrictBoundaries: boolean, activeDistrictName: string | null, is3D: boolean, showBuildings3D: boolean, showTerrain3D: boolean) {
  const layers = map.getStyle().layers ?? [];
  const firstRoadLayer = layers.find((layer: any) => layer.type === 'line' && ('source-layer' in layer ? layer['source-layer'] === 'transportation' : false))?.id;
  const showBuildingExtrusions = is3D && showBuildings3D && !showTerrain3D;
  const showBuildingFootprints = is3D && showBuildings3D && showTerrain3D;
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
    if (layer.type === 'symbol' || id.includes('building') || id.includes('boundary') || id === 'park_outline' || id === 'landcover_wetland' || id === 'road_area_pattern' || isRail || (isRestricted && layer.type === 'line')) {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
    if (layer.type === 'fill' && isWater) {
      map.setPaintProperty(layer.id, 'fill-color', '#102331');
      map.setPaintProperty(layer.id, 'fill-opacity', 0.92);
    }
    if (layer.type === 'fill' && isPark) {
      map.setPaintProperty(layer.id, 'fill-color', '#0e1b17');
      map.setPaintProperty(layer.id, 'fill-opacity', 0.86);
      if (id === 'park') map.setPaintProperty(layer.id, 'fill-outline-color', '#13251f');
    }
    if (layer.type === 'fill' && isRestricted) {
      map.setPaintProperty(layer.id, 'fill-color', '#241216');
      map.setPaintProperty(layer.id, 'fill-opacity', 0.9);
      map.setPaintProperty(layer.id, 'fill-outline-color', '#241216');
    }
    if (layer.type === 'line' && isWater) {
      map.setPaintProperty(layer.id, 'line-color', '#24465a');
      map.setPaintProperty(layer.id, 'line-opacity', 0.8);
    }
    if (layer.type === 'line' && isRestricted) {
      map.setPaintProperty(layer.id, 'line-color', '#6b3038');
      map.setPaintProperty(layer.id, 'line-opacity', 0.85);
    }
    if (isRoad && layer.type === 'line') {
      const isCycleway = /cycleway/.test(id);
      const isPedestrianFootpath = /footway|pedestrian/.test(id);
      const isGravelPath = /track|path|bridleway/.test(id) && !isPedestrianFootpath && !isCycleway;
      const isPath = isCycleway || isPedestrianFootpath || isGravelPath;
      const isMajor = /motorway|trunk|primary/.test(id);
      map.setLayerZoomRange(layer.id, ROAD_MIN_ZOOM, ROAD_MAX_ZOOM);
      const existingFilter = 'filter' in layer ? layer.filter : undefined;
      const parkingAisleFilter = ['!=', ['get', 'class'], 'parking_aisle'];
      const serviceRoadFilter = ['!=', ['get', 'class'], 'service'];
      map.setFilter(layer.id, ['all', ...(existingFilter ? [existingFilter] : []), parkingAisleFilter, serviceRoadFilter, ...(isPath ? [pathAccessFeature] : [])] as any);
      const isContextRoad = isHighway;
      map.setPaintProperty(layer.id, 'line-color', ['case', nonBikeableRoadFeature, '#3b1d23', isContextRoad, '#46504d', cyclewayFeature, ['match', ['get', 'surface'], UNPAVED_SURFACES, '#d59c67', '#2bb8b0'], surfaceColor('#55615c', '#72563d')]);
      // Pedestrian-only source layers use a dotted treatment. Keep them hidden
      // in the base map; the discovered GeoJSON overlay will reveal only the
      // pieces the player has actually uncovered.
      map.setPaintProperty(layer.id, 'line-opacity', isPedestrianFootpath ? 0 : ['case', nonBikeableRoadFeature, 0.62, isContextRoad, 0.68, isPath, 0.34, 0.46]);
      map.setPaintProperty(layer.id, 'line-width', isMajor ? ['interpolate', ['linear'], ['zoom'], 6, 0.9, 10, 1.1, 14, 4.5, 18, 7] : isPath ? ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 14, 2.4, 18, 3] : ['interpolate', ['linear'], ['zoom'], 6, 0.75, 10, 0.95, 14, 3, 18, 4]);
      map.setLayoutProperty(layer.id, 'line-cap', 'round');
      map.setLayoutProperty(layer.id, 'line-join', 'round');
      if (isPedestrianFootpath) map.setPaintProperty(layer.id, 'line-dasharray', [1, 2.5]);
      else if (isCycleway || isGravelPath || isContextRoad) map.setPaintProperty(layer.id, 'line-dasharray', null);
    }
  }
  if (map.getSource('openmaptiles') && !map.getLayer('roam-bikeable-paths')) {
    map.addLayer({
      id: 'roam-bikeable-paths',
      type: 'line',
      minzoom: ROAD_MIN_ZOOM,
      maxzoom: ROAD_MAX_ZOOM,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: bikeablePathFilter,
      paint: {
        'line-color': ['case', ['any', ['match', ['get', 'class'], ['cycleway'], true, false], ['match', ['get', 'subclass'], ['cycleway'], true, false]], ['match', ['get', 'surface'], UNPAVED_SURFACES, '#d59c67', '#2bb8b0'], surfaceColor('#55615c', '#72563d')],
        'line-opacity': 0.34,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 14, 2.4, 18, 3],
      },
    });
  }
  if (!map.getSource(DISTRICT_BOUNDARIES_SOURCE)) {
    map.addSource(DISTRICT_BOUNDARIES_SOURCE, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: STOCKHOLM_DISTRICTS.map(district => ({ type: 'Feature', properties: { name: district.name }, geometry: district.geometry })),
      },
    } as any);
  }
  if (!map.getLayer(DISTRICT_BOUNDARIES_FILL)) {
    map.addLayer({
      id: DISTRICT_BOUNDARIES_FILL,
      type: 'fill',
      source: DISTRICT_BOUNDARIES_SOURCE,
      paint: { 'fill-color': '#2bb8b0', 'fill-opacity': ['match', ['get', 'name'], activeDistrictName ?? '', 0.12, 0.025] },
    } as any, firstRoadLayer);
  }
  if (!map.getLayer(DISTRICT_BOUNDARIES_LINE)) {
    map.addLayer({
      id: DISTRICT_BOUNDARIES_LINE,
      type: 'line',
      source: DISTRICT_BOUNDARIES_SOURCE,
      paint: { 'line-color': '#9bbab1', 'line-opacity': 0.72, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 14, 2.5, 18, 3] },
    } as any);
  }
  if (map.getLayer(DISTRICT_BOUNDARIES_FILL)) {
    map.setPaintProperty(DISTRICT_BOUNDARIES_FILL, 'fill-opacity', ['match', ['get', 'name'], activeDistrictName ?? '', 0.12, 0.025]);
  }
  for (const id of [DISTRICT_BOUNDARIES_FILL, DISTRICT_BOUNDARIES_LINE]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showDistrictBoundaries ? 'visible' : 'none');
  }
  if (!map.getSource(DISCOVERED_SOURCE)) {
    map.addSource(DISCOVERED_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getLayer(DISCOVERED_SOURCE)) {
    map.addLayer({
      id: DISCOVERED_SOURCE,
      type: 'line',
      minzoom: ROAD_MIN_ZOOM,
      maxzoom: ROAD_MAX_ZOOM,
      source: DISCOVERED_SOURCE,
      paint: {
        'line-color': ['match', ['get', 'roadType'], 'cycleway', '#2bb8b0', 'unpaved-path', '#d59c67', 'footpath', '#f0eee7', '#f0eee7'],
        'line-opacity': 0.98,
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 15, 1.8, 18, 3],
      },
      layout: { visibility: showDiscovered ? 'visible' : 'none' },
    } as any);
  }
  if (!map.getSource(PLAYER_DISCOVERY_SOURCE)) {
    map.addSource(PLAYER_DISCOVERY_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getLayer(PLAYER_DISCOVERY_FILL)) {
    map.addLayer({
      id: PLAYER_DISCOVERY_FILL,
      type: 'fill',
      source: PLAYER_DISCOVERY_SOURCE,
      paint: { 'fill-color': '#2bb8b0', 'fill-opacity': 0.12 },
    } as any, firstRoadLayer);
  }
  if (!map.getLayer(PLAYER_DISCOVERY_LINE)) {
    map.addLayer({
      id: PLAYER_DISCOVERY_LINE,
      type: 'line',
      source: PLAYER_DISCOVERY_SOURCE,
      paint: { 'line-color': '#b9fff7', 'line-opacity': 0.72, 'line-width': 1.5, 'line-dasharray': [2, 2] },
    } as any, firstRoadLayer);
  }
  if (map.getSource('openmaptiles') && !map.getLayer('roam-buildings-3d')) {
    map.addLayer({
      id: 'roam-buildings-3d',
      type: 'fill-extrusion',
      minzoom: 13,
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: {
        'fill-extrusion-color': '#27302e',
        'fill-extrusion-opacity': 0.28,
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 0],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        'fill-extrusion-vertical-gradient': true,
      },
      layout: { visibility: is3D && showBuildings3D ? 'visible' : 'none' },
    } as any, firstRoadLayer);
  }
  if (map.getSource('openmaptiles') && !map.getLayer('roam-building-footprints')) {
    map.addLayer({
      id: 'roam-building-footprints',
      type: 'fill',
      minzoom: 13,
      source: 'openmaptiles',
      'source-layer': 'building',
      paint: {
        'fill-color': '#27302e',
        'fill-opacity': 0.2,
        'fill-outline-color': '#3b4642',
      },
      layout: { visibility: showBuildingFootprints ? 'visible' : 'none' },
    } as any, firstRoadLayer);
  }
  // Keep transparent extrusions behind every transportation layer. This is
  // especially important with terrain enabled, where MapLibre's 3D render
  // pass can otherwise make an incorrectly anchored extrusion cover roads.
  const roadLayer = map.getStyle().layers?.find((layer: any) => layer.type === 'line' && ('source-layer' in layer ? layer['source-layer'] === 'transportation' : false));
  if (roadLayer && map.getLayer('roam-buildings-3d')) map.moveLayer('roam-buildings-3d', roadLayer.id);
  if (map.getLayer('roam-buildings-3d')) map.setLayoutProperty('roam-buildings-3d', 'visibility', showBuildingExtrusions ? 'visible' : 'none');
  if (map.getLayer('roam-building-footprints')) map.setLayoutProperty('roam-building-footprints', 'visibility', showBuildingFootprints ? 'visible' : 'none');
  if (is3D && showTerrain3D) {
    if (!map.getSource(TERRAIN_SOURCE)) map.addSource(TERRAIN_SOURCE, { type: 'raster-dem', url: TERRAIN_TILEJSON, tileSize: 512, encoding: 'terrarium' } as any);
    if (!map.getSource(HILLSHADE_SOURCE)) map.addSource(HILLSHADE_SOURCE, { type: 'raster-dem', url: TERRAIN_TILEJSON, tileSize: 512, encoding: 'terrarium' } as any);
    map.setSourceTileLodParams(TERRAIN_LOD_LEVELS, TERRAIN_TILE_RATIO, TERRAIN_SOURCE);
    if (!map.getLayer('roam-terrain-hillshade')) {
      map.addLayer({
        id: 'roam-terrain-hillshade',
        type: 'hillshade',
        source: HILLSHADE_SOURCE,
        paint: { 'hillshade-shadow-color': '#071216', 'hillshade-highlight-color': '#30403a', 'hillshade-exaggeration': 0.32 },
        layout: { visibility: 'visible' },
      } as any, firstRoadLayer);
    } else map.setLayoutProperty('roam-terrain-hillshade', 'visibility', 'visible');
    const terrain = map.getTerrain();
    if (!terrain || terrain.source !== TERRAIN_SOURCE || terrain.exaggeration !== TERRAIN_EXAGGERATION) map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION });
  } else {
    if (map.getLayer('roam-terrain-hillshade')) map.setLayoutProperty('roam-terrain-hillshade', 'visibility', 'none');
    if (map.getTerrain()) map.setTerrain(null);
  }
  if (map.getSource('openmaptiles')) {
    if (!map.getLayer('roam-restricted-landuse')) {
      map.addLayer({
        id: 'roam-restricted-landuse',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['match', ['get', 'class'], ['military'], true, false] as any,
        paint: { 'fill-color': '#241216', 'fill-opacity': 0.94 },
      } as any);
    }
    if (!map.getLayer('roam-restricted-aeroway')) {
      map.addLayer({
        id: 'roam-restricted-aeroway',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'aeroway',
        filter: ['match', ['get', 'class'], ['aerodrome', 'airport'], true, false] as any,
        paint: { 'fill-color': '#241216', 'fill-opacity': 0.94 },
      } as any);
    }
  }
  if (map.getLayer(DISCOVERED_SOURCE)) {
    map.setLayoutProperty(DISCOVERED_SOURCE, 'visibility', showDiscovered ? 'visible' : 'none');
  }
  // Keep the existing generalized overview below z12; use the same filters and
  // paints against complete z14 geometry at useful cycling zooms.
  if (map.getSource(NETWORK_SOURCE)) {
    for (const id of ['roam-bikeable-paths']) {
      const detailId = `${id}-detail`;
      if (!map.getLayer(detailId)) {
        const original = map.getStyle().layers.find((layer: any) => layer.id === id);
        if (original?.type === 'line') {
          map.addLayer({ ...original, id: detailId, source: NETWORK_SOURCE, minzoom: NETWORK_MIN_ZOOM }, id);
          map.setLayerZoomRange(id, ROAD_MIN_ZOOM, NETWORK_MIN_ZOOM);
        }
      }
    }
  }
}

function roadTypeForFeature(properties: Record<string, unknown>) {
  return roadTypeForProperties(properties);
}

function progressStatsForDistrict(districtId: string, discoveries: DiscoveredSegment[]): ProgressStats {
  const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(districtId)?.denominators;
  if (!denominator) return CURRENT_PROGRESS;
  const discovered = new globalThis.Map<string, DiscoveredSegment>(discoveries.filter(segment => segment.regionId === districtId).map(segment => [segment.id, segment]));
  const discoveredIds = new Set(discovered.keys());
  const counts = { 'paved-road': 0, cycleway: 0, 'unpaved-path': 0, footpath: 0 };
  for (const segment of discovered.values()) {
    if (segment.roadType === 'paved-road') counts['paved-road']++;
    else if (segment.roadType === 'cycleway') counts.cycleway++;
    else if (segment.roadType === 'unpaved-path') counts['unpaved-path']++;
    else if (segment.roadType === 'footpath') counts.footpath++;
  }
  const percentage = (value: number, total: number) => total ? Math.min(100, value / total * 100) : 0;
  return { discovered: percentage(discoveredIds.size, denominator.segments), pavedBikeableRoads: percentage(counts['paved-road'], denominator.byRoadType['paved-road'].segments), pavedCycleways: percentage(counts.cycleway, denominator.byRoadType.cycleway.segments), unpavedPaths: percentage(counts['unpaved-path'], denominator.byRoadType['unpaved-path'].segments), footpaths: percentage(counts.footpath, denominator.byRoadType.footpath.segments) };
}

function isDiscoverableFeature(properties: Record<string, unknown>) {
  return isDiscoverableProperties(properties);
}

function candidatesFromMap(map: Map, location: PlayerLocation): RoadCandidate[] {
  try {
    const candidates: RoadCandidate[] = [];
    const latitudePadding = DISCOVERY_RADIUS_METERS / 111_320;
    const longitudePadding = DISCOVERY_RADIUS_METERS / (111_320 * Math.cos(location.lat * Math.PI / 180));
    map.querySourceFeatures(NETWORK_SOURCE, { sourceLayer: 'transportation' }).forEach((feature: any) => {
      const properties = feature.properties ?? {};
      if (!isDiscoverableFeature(properties)) return;
      const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [];
      lines.forEach((coordinates: [number, number][], part: number) => {
        if (coordinates.length < 2) return;
        const lngs = coordinates.map(([lng]) => lng);
        const lats = coordinates.map(([, lat]) => lat);
        if (Math.max(...lngs) < location.lng - longitudePadding || Math.min(...lngs) > location.lng + longitudePadding || Math.max(...lats) < location.lat - latitudePadding || Math.min(...lats) > location.lat + latitudePadding) return;
        const roadType = roadTypeForFeature(properties);
        candidates.push({ id: stableRoadCandidateId(coordinates, roadType), geometry: { type: 'LineString', coordinates }, roadType });
      });
    });
    return candidates;
  } catch {
    return [];
  }
}

function findMapLocality(map: Map) {
  const center = map.getCenter();
  const features = map.querySourceFeatures('openmaptiles', { sourceLayer: 'place' });
  const candidates = features
    .filter((feature) => typeof feature.properties?.name === 'string')
    .map((feature) => ({ name: String(feature.properties.name), className: String(feature.properties.class || ''), rank: Number(feature.properties.rank || 99), distance: feature.geometry.type === 'Point' ? Math.hypot((feature.geometry.coordinates[0] as number) - center.lng, (feature.geometry.coordinates[1] as number) - center.lat) : 99 }))
    .sort((a, b) => a.distance - b.distance || a.rank - b.rank);
  const city = candidates.find((candidate) => ['city', 'town', 'village'].includes(candidate.className));
  const region = candidates.find((candidate) => ['suburb', 'neighbourhood', 'quarter', 'district'].includes(candidate.className));
  return { city: city?.name, region: region?.name };
}

function loadCachedMapCenter(): [number, number] | null {
  try {
    const cached = JSON.parse(localStorage.getItem(LAST_MAP_CENTER_STORAGE_KEY) ?? 'null') as { lng?: unknown; lat?: unknown } | null;
    return cached && typeof cached.lng === 'number' && typeof cached.lat === 'number' ? [cached.lng, cached.lat] : null;
  } catch {
    return null;
  }
}

function MapCanvas({ mapRef, showDiscovered, showDistrictBoundaries, is3D, showBuildings3D, showTerrain3D, playerLocation, followPlayer, activeRotationFollow, discoveries, onDiscoveries, onLocationChange, onBearingChange, onZoomChange, onPitchChange, onFollowPlayerChange }: { mapRef: React.MutableRefObject<Map | null>; showDiscovered: boolean; showDistrictBoundaries: boolean; is3D: boolean; showBuildings3D: boolean; showTerrain3D: boolean; playerLocation: PlayerLocation | null; followPlayer: boolean; activeRotationFollow: boolean; discoveries: DiscoveredSegment[]; onDiscoveries: (segments: DiscoveredSegment[]) => void; onLocationChange: (lng: number, lat: number, locality?: { city?: string; region?: string }) => void; onBearingChange: (bearing: number) => void; onZoomChange: (zoom: number) => void; onPitchChange: (pitch: number) => void; onFollowPlayerChange: (following: boolean) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerMarkerRef = useRef<maplibregl.Marker | null>(null);
  const markerAnimationFrameRef = useRef<number | null>(null);
  const markerRotationFrameRef = useRef<number | null>(null);
  const markerRotationRef = useRef(0);
  const onFollowPlayerChangeRef = useRef(onFollowPlayerChange);
  const discoveriesRef = useRef(discoveries);
  const initialCenterRef = useRef<[number, number]>(loadCachedMapCenter() ?? [18.0649, 59.3326]);
  const hasCenteredOnFirstLiveLocationRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapDistrictName, setMapDistrictName] = useState<string | null>(null);
  const [networkRevision, setNetworkRevision] = useState(0);
  useEffect(() => { discoveriesRef.current = discoveries; }, [discoveries]);
  useEffect(() => { onFollowPlayerChangeRef.current = onFollowPlayerChange; }, [onFollowPlayerChange]);
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: initialCenterRef.current, zoom: DEFAULT_MAP_ZOOM, pitch: DEFAULT_3D_PITCH, bearing: 0, maxPitch: MAX_MAP_PITCH, attributionControl: false, canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' } });
    mapRef.current = map;
    let removeNetworkProtocol = () => {};
    map.on('load', () => {
      removeNetworkProtocol = installNetworkSource(map);
      const center = map.getCenter();
      const centerDistrictName = findStockholmDistrict([center.lng, center.lat])?.name ?? null;
      setMapDistrictName(centerDistrictName);
      styleRoamMap(map, showDiscovered, showDistrictBoundaries, centerDistrictName, is3D, showBuildings3D, showTerrain3D);
      onLocationChange(center.lng, center.lat, findMapLocality(map));
      onBearingChange(map.getBearing());
      onZoomChange(map.getZoom());
      onPitchChange(map.getPitch());
      setMapReady(true);
    });
    map.on('rotate', () => onBearingChange(map.getBearing()));
    map.on('zoom', () => onZoomChange(map.getZoom()));
    map.on('pitch', () => onPitchChange(map.getPitch()));
    map.on('moveend', () => {
      const center = map.getCenter();
      setMapDistrictName(findStockholmDistrict([center.lng, center.lat])?.name ?? null);
      onLocationChange(center.lng, center.lat, findMapLocality(map));
    });
    map.on('idle', () => setNetworkRevision(revision => revision + 1));
    const stopFollowingForGesture = () => onFollowPlayerChangeRef.current(false);
    const stopFollowingForUserEvent = (event: any) => { if (event.originalEvent) stopFollowingForGesture(); };
    map.on('dragstart', stopFollowingForGesture);
    map.on('rotatestart', stopFollowingForUserEvent);
    map.on('pitchstart', stopFollowingForUserEvent);
    map.on('zoomstart', (event: any) => { if (event.originalEvent) stopFollowingForGesture(); });
    return () => { if (markerAnimationFrameRef.current !== null) cancelAnimationFrame(markerAnimationFrameRef.current); if (markerRotationFrameRef.current !== null) cancelAnimationFrame(markerRotationFrameRef.current); playerMarkerRef.current?.remove(); playerMarkerRef.current = null; map.remove(); removeNetworkProtocol(); mapRef.current = null; };
  }, [mapRef]);
  useEffect(() => {
    if (mapReady && mapRef.current) styleRoamMap(mapRef.current, showDiscovered, showDistrictBoundaries, playerLocation && followPlayer ? findStockholmDistrict([playerLocation.lng, playerLocation.lat])?.name ?? mapDistrictName : mapDistrictName, is3D, showBuildings3D, showTerrain3D);
  }, [mapReady, mapRef, showDiscovered, showDistrictBoundaries, is3D, showBuildings3D, showTerrain3D, playerLocation, followPlayer, mapDistrictName]);
  useEffect(() => {
    if (mapReady && mapRef.current) {
      mapRef.current.easeTo({ pitch: is3D ? DEFAULT_3D_PITCH : 0, duration: 450 });
    }
  }, [mapReady, mapRef, is3D]);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource(DISCOVERED_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: discoveries.map(segment => ({ type: 'Feature', properties: { roadType: segment.roadType }, geometry: segment.geometry })) } as any);
  }, [discoveries, mapReady, mapRef]);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource(PLAYER_DISCOVERY_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(playerLocation
      ? circle([playerLocation.lng, playerLocation.lat], DISCOVERY_RADIUS_METERS, { units: 'meters', steps: 64 }) as any
      : { type: 'FeatureCollection', features: [] });
  }, [mapReady, mapRef, playerLocation]);
  useEffect(() => {
    if (!mapReady || !mapRef.current || !playerLocation) return;
    const district = findStockholmDistrict([playerLocation.lng, playerLocation.lat]);
    const newlyDiscovered = discoverSegments(playerLocation, candidatesFromMap(mapRef.current, playerLocation), new Set(discoveriesRef.current.map(segment => segment.id)), district);
    if (!newlyDiscovered.length) return;
    discoveriesRef.current = [...discoveriesRef.current, ...newlyDiscovered];
    onDiscoveries(newlyDiscovered);
  }, [mapReady, mapRef, networkRevision, onDiscoveries, playerLocation]);
  useEffect(() => {
    if (!mapReady || !mapRef.current || !playerLocation || hasCenteredOnFirstLiveLocationRef.current) return;
    hasCenteredOnFirstLiveLocationRef.current = true;
    mapRef.current.jumpTo({ center: [playerLocation.lng, playerLocation.lat], zoom: DEFAULT_MAP_ZOOM, pitch: is3D ? DEFAULT_3D_PITCH : 0 });
  }, [is3D, mapReady, mapRef, playerLocation]);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (!playerLocation) {
      if (markerAnimationFrameRef.current !== null) cancelAnimationFrame(markerAnimationFrameRef.current);
      if (markerRotationFrameRef.current !== null) cancelAnimationFrame(markerRotationFrameRef.current);
      markerAnimationFrameRef.current = null;
      markerRotationFrameRef.current = null;
      markerRotationRef.current = 0;
      playerMarkerRef.current?.remove();
      playerMarkerRef.current = null;
      return;
    }
    let markerWasCreated = false;
    if (!playerMarkerRef.current) {
      const element = document.createElement('div');
      element.className = 'player-marker player-marker--stationary';
      element.setAttribute('aria-label', 'Your current location');
      element.innerHTML = '<svg class="player-marker__arrow" viewBox="0 0 32 40" aria-hidden="true"><path d="M16 1 31 35 16 29 1 35Z" /></svg>';
      // addTo immediately projects the marker, so coordinates must exist first.
      playerMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat([playerLocation.lng, playerLocation.lat])
        .addTo(mapRef.current);
      markerWasCreated = true;
    }
    const marker = playerMarkerRef.current;
    if (!markerWasCreated) {
      if (markerAnimationFrameRef.current !== null) cancelAnimationFrame(markerAnimationFrameRef.current);
      const start = marker.getLngLat();
      const destination: [number, number] = [playerLocation.lng, playerLocation.lat];
      const startedAt = performance.now();
      const animateMarker = (now: number) => {
        const progress = Math.min((now - startedAt) / 650, 1);
        const eased = 1 - (1 - progress) ** 3;
        marker.setLngLat([start.lng + (destination[0] - start.lng) * eased, start.lat + (destination[1] - start.lat) * eased]);
        if (progress < 1) markerAnimationFrameRef.current = requestAnimationFrame(animateMarker);
        else markerAnimationFrameRef.current = null;
      };
      markerAnimationFrameRef.current = requestAnimationFrame(animateMarker);
    }
    const targetRotation = playerLocation.travelHeading ?? 0;
    if (markerWasCreated) {
      markerRotationRef.current = targetRotation;
      marker.setRotation(targetRotation);
    } else {
      if (markerRotationFrameRef.current !== null) cancelAnimationFrame(markerRotationFrameRef.current);
      const startRotation = markerRotationRef.current;
      const shortestTurn = ((targetRotation - startRotation + 540) % 360) - 180;
      const finalRotation = startRotation + shortestTurn;
      const startedAt = performance.now();
      const animateRotation = (now: number) => {
        const progress = Math.min((now - startedAt) / 500, 1);
        const eased = 1 - (1 - progress) ** 3;
        const rotation = startRotation + (finalRotation - startRotation) * eased;
        markerRotationRef.current = rotation;
        marker.setRotation(rotation);
        if (progress < 1) markerRotationFrameRef.current = requestAnimationFrame(animateRotation);
        else markerRotationFrameRef.current = null;
      };
      markerRotationFrameRef.current = requestAnimationFrame(animateRotation);
    }
    marker.getElement().classList.toggle('player-marker--moving', playerLocation.isMoving);
    marker.getElement().classList.toggle('player-marker--stationary', !playerLocation.isMoving);
    if (followPlayer) {
      mapRef.current.easeTo({
        center: [playerLocation.lng, playerLocation.lat],
        ...(activeRotationFollow && playerLocation.isMoving && playerLocation.travelHeading !== null ? { bearing: playerLocation.travelHeading } : {}),
        duration: 850,
      });
    }
  }, [followPlayer, mapReady, mapRef, playerLocation]);
  return <div className="map-canvas"><div ref={containerRef} className={mapReady ? 'maplibre-container maplibre-container--ready' : 'maplibre-container'} /><div className={is3D ? 'map-depth-fade' : 'map-depth-fade map-depth-fade--hidden'} aria-hidden="true" />
    {!mapReady && <div className="map-loading">LOADING ROAD DATA…</div>}
  </div>;
}

function MapView({ onOpenProgress, onRequestLocation, sessionActive, onSessionChange, showDiscovered, setShowDiscovered, showDistrictBoundaries, setShowDistrictBoundaries, is3D, setIs3D, showBuildings3D, setShowBuildings3D, showTerrain3D, setShowTerrain3D, showDebugMenu, playerLocation, discoveries, onDiscoveries }: { onOpenProgress: (location: LocationState) => void; onRequestLocation: () => void; sessionActive: boolean; onSessionChange: (active: boolean) => void; showDiscovered: boolean; setShowDiscovered: (value: boolean) => void; showDistrictBoundaries: boolean; setShowDistrictBoundaries: (value: boolean) => void; is3D: boolean; setIs3D: (value: boolean) => void; showBuildings3D: boolean; setShowBuildings3D: (value: boolean) => void; showTerrain3D: boolean; setShowTerrain3D: (value: boolean) => void; showDebugMenu: boolean; playerLocation: PlayerLocation | null; discoveries: DiscoveredSegment[]; onDiscoveries: (segments: DiscoveredSegment[]) => void }) {
  const [bearing, setBearing] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_MAP_ZOOM);
  const [pitch, setPitch] = useState(DEFAULT_3D_PITCH);
  const [followPlayer, setFollowPlayer] = useState(false);
  const [activeRotationFollow, setActiveRotationFollow] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [location, setLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const [sessionDockHeight, setSessionDockHeight] = useState(76);
  const mapRef = useRef<Map | null>(null);
  const sessionDockRef = useRef<HTMLDivElement | null>(null);
  const wakeLockStatus = useScreenWakeLock(sessionActive);
  useEffect(() => {
    const dock = sessionDockRef.current;
    if (!dock) return;
    const updateHeight = () => setSessionDockHeight(Math.ceil(dock.getBoundingClientRect().height));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (!playerLocation) { setFollowPlayer(false); setActiveRotationFollow(false); } }, [playerLocation]);
  const handleLocationChange = (lng: number, lat: number, locality?: { city?: string; region?: string }) => setLocation((current) => ({ ...current, lng, lat, city: locality?.city?.toUpperCase() || current.city, region: locality?.region?.toUpperCase() || current.region }));
  const handleBearingChange = (nextBearing: number) => setBearing((previousBearing) => {
    let adjustedBearing = nextBearing;
    while (adjustedBearing - previousBearing > 180) adjustedBearing -= 360;
    while (adjustedBearing - previousBearing < -180) adjustedBearing += 360;
    return adjustedBearing;
  });
  const currentDistrict = findStockholmDistrict([location.lng, location.lat]);
  const currentDistrictDiscoveries = discoveries.filter(segment => segment.regionId === currentDistrict?.id);
  const discoveredMeters = currentDistrictDiscoveries.reduce((total, segment) => total + segment.lengthMeters, 0);
  const discoveredBikeableMeters = bikeableDiscoveredMeters(currentDistrictDiscoveries);
  const currentDistrictStats = currentDistrict ? progressStatsForDistrict(currentDistrict.id, discoveries) : CURRENT_PROGRESS;
  const currentDistrictDenominator = currentDistrict ? STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(currentDistrict.id)?.denominators : undefined;
  const sessionDockOffset = `calc(${sessionDockHeight}px + var(--spacing-map-edge) + var(--spacing-map-edge))`;
  const centerOnPlayer = () => {
    if (!playerLocation) {
      onRequestLocation();
      return;
    }
    if (!followPlayer) {
      setFollowPlayer(true);
      return;
    }
    if (!activeRotationFollow) {
      setActiveRotationFollow(true);
      setIs3D(true);
      mapRef.current?.easeTo({ center: [playerLocation.lng, playerLocation.lat], ...(playerLocation.isMoving && playerLocation.travelHeading !== null ? { bearing: playerLocation.travelHeading } : {}), duration: 850 });
      return;
    }
    setActiveRotationFollow(false);
    setIs3D(false);
  };
  const isFollowingPlayer = followPlayer && Boolean(playerLocation);
  const handleFollowChange = (following: boolean) => { setFollowPlayer(following); if (!following) setActiveRotationFollow(false); };
  const resetCompass = () => { setActiveRotationFollow(false); mapRef.current?.easeTo({ bearing: 0, duration: 450 }); };
  const locationControlClass = activeRotationFollow ? 'map-ui-surface location-control location-control--following location-control--active' : isFollowingPlayer ? 'map-ui-surface location-control location-control--following' : 'map-ui-surface location-control';
  const locationControlLabel = activeRotationFollow ? 'Active heading follow' : isFollowingPlayer ? 'Following your location' : 'Follow your location';
  return <section className="map-view map-view--has-session-dock"><MapCanvas mapRef={mapRef} showDiscovered={showDiscovered} showDistrictBoundaries={showDistrictBoundaries} is3D={is3D} showBuildings3D={showBuildings3D} showTerrain3D={showTerrain3D} playerLocation={playerLocation} followPlayer={followPlayer} activeRotationFollow={activeRotationFollow} discoveries={discoveries} onDiscoveries={onDiscoveries} onLocationChange={handleLocationChange} onBearingChange={handleBearingChange} onZoomChange={setZoom} onPitchChange={setPitch} onFollowPlayerChange={handleFollowChange} />{!isFollowingPlayer && <div className="map-center-crosshair" aria-hidden="true"><span /></div>}
    <header className="map-header"><span className="map-header-spacer" aria-hidden="true" /><ShadcnButton variant="secondary" className="location-summary map-ui-surface" onClick={() => onOpenProgress(location)}><DistrictProgressContent title={<><span className="district-progress-title-context">{formatItemText(location.city)} / </span><span className="district-progress-title-active">{formatItemText(currentDistrict?.name ?? location.region)}</span></>} distance={currentDistrictDenominator ? `${formatDistance(discoveredBikeableMeters)} / ${formatDistance(bikeableLengthMeters(currentDistrictDenominator))}` : discoveredMeters > 0 ? `${formatDistance(discoveredMeters)} discovered` : 'Catalog ready'} percentage={currentDistrictDenominator ? `${currentDistrictStats.discovered.toFixed(1)}%` : '—'} stats={currentDistrictStats} /></ShadcnButton></header>
    <div className="map-controls" style={{ bottom: sessionDockOffset }} aria-label="Map controls"><div className="map-compass"><ShadcnButton variant="secondary" size="icon" className="map-ui-surface" aria-label="Reset compass north" onClick={resetCompass}><span className="compass-rotor" style={{ transform: `rotate(${-bearing}deg)` }}><i className="compass-needle"><b className="compass-north">▲</b><b className="compass-south">▼</b></i></span></ShadcnButton></div><ShadcnButton variant="secondary" size="icon" className={locationControlClass} aria-label={locationControlLabel} aria-pressed={isFollowingPlayer} onClick={centerOnPlayer}><CrosshairSimple weight="regular" aria-hidden="true" /></ShadcnButton><ShadcnButton variant="secondary" size="sm" className="map-ui-surface map-mode-toggle" aria-label={`Switch to ${is3D ? '2D' : '3D'} view`} onClick={() => setIs3D(!is3D)}>{is3D ? '3D' : '2D'}</ShadcnButton><ButtonGroup orientation="vertical" className="zoom-group map-ui-surface"><ShadcnButton variant="ghost" size="icon" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}><Plus weight="regular" aria-hidden="true" /></ShadcnButton><ShadcnButton variant="ghost" size="icon" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}><Minus weight="regular" aria-hidden="true" /></ShadcnButton></ButtonGroup></div><div ref={sessionDockRef} className="session-dock map-ui-surface"><div className="min-w-0"><span className="dock-label font-sans text-body font-semibold tracking-normal text-text">{sessionActive ? 'Session active' : 'Ready to ride'}</span><strong className="block font-sans text-body font-normal tracking-normal text-text-subtle">{sessionActive ? (wakeLockStatus === 'active' ? 'Screen stays awake' : wakeLockStatus === 'unsupported' ? 'Screen lock unavailable here' : 'Keeping ride active') : 'Start a recording'}</strong></div><ShadcnButton variant={sessionActive ? 'destructive' : 'primary'} onClick={() => onSessionChange(!sessionActive)}>{sessionActive ? 'End ride' : 'Start ride'}</ShadcnButton></div>
    {showDebugMenu && <div className="map-debug" style={{ bottom: sessionDockOffset }}><ShadcnButton variant="secondary" size="icon" className="map-ui-surface debug-icon" aria-label="Open debug settings" aria-expanded={debugOpen} onClick={() => setDebugOpen(!debugOpen)}><Bug weight="regular" aria-hidden="true" /></ShadcnButton>{debugOpen && <div className="debug-menu map-ui-surface"><p>DEBUG SETTINGS</p><label><span>DISCOVERED LAYER</span><Switch checked={showDiscovered} onCheckedChange={setShowDiscovered} aria-label="Discovered layer" /></label><label><span>DISTRICT BOUNDARIES</span><Switch checked={showDistrictBoundaries} onCheckedChange={setShowDistrictBoundaries} aria-label="District boundaries" /></label><label><span>BUILDINGS 3D</span><Switch checked={showBuildings3D} onCheckedChange={setShowBuildings3D} aria-label="Buildings 3D" /></label><label><span>TERRAIN 3D</span><Switch checked={showTerrain3D} onCheckedChange={setShowTerrain3D} aria-label="Terrain 3D" /></label><div><span>ZOOM LEVEL</span><b className="debug-value">{zoom.toFixed(1)}</b></div><div><span>CAMERA PITCH</span><b className="debug-value">{pitch.toFixed(0)}°</b></div></div>}</div>}
  </section>;
}

function formatItemText(value: string) {
  const lower = value.toLocaleLowerCase('sv-SE');
  const sentence = lower.charAt(0).toLocaleUpperCase('sv-SE') + lower.slice(1);
  return sentence.replace(/^Gps\b/, 'GPS').replace(/\b(\d+)d\b/gi, (_, digits: string) => `${digits}D`);
}

function SettingToggle({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  const displayLabel = formatItemText(label);
  return <Item render={<label />} variant="outline" className="rounded-none border-0 border-b border-border-muted bg-transparent px-0 py-4 last:border-b-0"><ItemContent><ItemTitle>{displayLabel}</ItemTitle><ItemDescription>{description}</ItemDescription></ItemContent><Switch checked={value} onCheckedChange={onChange} aria-label={displayLabel} /></Item>;
}

type ButtonProps = ComponentPropsWithoutRef<'button'> & { variant?: 'primary' | 'secondary' | 'quiet'; size?: 'default' | 'compact' };

function Button({ className = '', variant = 'primary', size = 'default', type = 'button', ...props }: ButtonProps) {
  return <ShadcnButton variant={variant === 'primary' ? 'primary' : variant === 'secondary' ? 'secondary' : 'ghost'} size={size === 'compact' ? 'sm' : 'default'} className={className} type={type} {...props} />;
}

function IconButton({ label, children, className = '', ...props }: Omit<ButtonProps, 'children'> & { label: string; children: ReactNode }) {
  return <Button aria-label={label} className={`size-control rounded-control p-0 ${className}`} variant="secondary" {...props}>{children}</Button>;
}

function Surface({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-panel border border-border bg-surface-raised ${className}`}>{children}</section>;
}

function Toggle({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (value: boolean) => void }) {
  return <button className="flex min-h-control w-full items-center justify-between gap-4 px-0 text-left hover:text-paper-50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus" type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)}><span className="flex min-w-0 flex-col gap-1"><span className="font-mono text-data font-semibold tracking-[0.06em] text-text">{label}</span>{description && <span className="text-body text-text-subtle">{description}</span>}</span><span className={`relative h-[18px] w-[34px] shrink-0 rounded-pill border transition-colors duration-200 ${value ? 'border-accent bg-accent-muted' : 'border-border-strong bg-control-off'}`} aria-hidden="true"><span className={`absolute top-[3px] size-2.5 rounded-full transition-all duration-200 ${value ? 'translate-x-4 bg-paper-100' : 'translate-x-[3px] bg-slate-400'}`} /></span></button>;
}

function Tabs<T extends string>({ items, value, onChange }: { items: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (value: T) => void }) {
  return <div className="inline-flex gap-4 border-b border-border-muted" role="tablist" aria-label="Design system sections">{items.map((item) => <button key={item.value} className={`min-h-control-compact border-b-2 font-mono text-overline-lg font-semibold uppercase tracking-[0.12em] transition-[color,border-color] duration-150 ease-outdoor focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-focus ${value === item.value ? 'border-accent text-paper-50' : 'border-transparent text-text-subtle hover:border-border-strong hover:text-text-muted'}`} type="button" role="tab" aria-selected={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}

const TOKEN_SEMANTIC = [
  ['location-500', 'bg-location-500'], ['location-200', 'bg-location-200'], ['danger-500', 'bg-danger-500'],
  ['surface', 'bg-surface'], ['surface-raised', 'bg-surface-raised'], ['surface-interactive', 'bg-surface-interactive'],
  ['text', 'bg-text'], ['text-muted', 'bg-text-muted'], ['text-subtle', 'bg-text-subtle'], ['border', 'bg-border'], ['border-subtle', 'bg-border-subtle'], ['border-muted', 'bg-border-muted'], ['border-strong', 'bg-border-strong'], ['focus', 'bg-focus'], ['accent', 'bg-accent'],
] as const;

const TOKEN_PRIMITIVES = [
  ['ink-700', 'bg-ink-700'], ['ink-800', 'bg-ink-800'], ['ink-900', 'bg-ink-900'], ['ink-950', 'bg-ink-950'],
  ['slate-300', 'bg-slate-300'], ['slate-400', 'bg-slate-400'], ['slate-500', 'bg-slate-500'], ['slate-600', 'bg-slate-600'],
  ['paper-50', 'bg-paper-50'], ['paper-100', 'bg-paper-100'], ['paper-200', 'bg-paper-200'], ['paper-300', 'bg-paper-300'],
] as const;

function TokenGrid({ tokens }: { tokens: ReadonlyArray<readonly [string, string]> }) {
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-3">{tokens.map(([name]) => <div key={name} className="min-w-0"><div className="h-12 w-full rounded-control border border-white/10" style={{ backgroundColor: `var(--color-${name})` }} /><p className="mt-2 truncate font-mono text-label text-text-muted">{name}</p></div>)}</div>;
}

const SEMANTIC_GROUPS = [
  ['Map & status', [['location-500', 'bg-location-500'], ['location-200', 'bg-location-200'], ['danger-500', 'bg-danger-500']]],
  ['Surfaces', [['surface', 'bg-surface'], ['surface-raised', 'bg-surface-raised'], ['surface-interactive', 'bg-surface-interactive']]],
  ['Content', [['text', 'bg-text'], ['text-muted', 'bg-text-muted'], ['text-subtle', 'bg-text-subtle']]],
  ['Borders & focus', [['border', 'bg-border'], ['border-subtle', 'bg-border-subtle'], ['border-muted', 'bg-border-muted'], ['border-strong', 'bg-border-strong'], ['focus', 'bg-focus']]],
  ['Accent', [['accent', 'bg-accent']]],
] as const;

const PRIMITIVE_GROUPS = [
  ['Ink · bright → dark', [['ink-700', 'bg-ink-700'], ['ink-800', 'bg-ink-800'], ['ink-900', 'bg-ink-900'], ['ink-950', 'bg-ink-950']]],
  ['Slate · bright → dark', [['slate-300', 'bg-slate-300'], ['slate-400', 'bg-slate-400'], ['slate-500', 'bg-slate-500'], ['slate-600', 'bg-slate-600']]],
  ['Paper · bright → dark', [['paper-50', 'bg-paper-50'], ['paper-100', 'bg-paper-100'], ['paper-200', 'bg-paper-200'], ['paper-300', 'bg-paper-300']]],
] as const;

function TokenGroups({ groups }: { groups: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> }) {
  return <div className="space-y-6">{groups.map(([label, tokens]) => <section key={label}><p className="mb-3 font-mono text-label font-semibold tracking-[0.12em] text-text-subtle">{label}</p><TokenGrid tokens={tokens} /></section>)}</div>;
}

function ColorTokenTabs() {
  return <ShadcnTabs className="col-span-full w-full" defaultValue="semantic"><TabsList variant="line"><TabsTrigger value="semantic">Semantic</TabsTrigger><TabsTrigger value="primitives">Primitives</TabsTrigger></TabsList><TabsContent value="semantic" className="tab-panel pt-4"><TokenGroups groups={SEMANTIC_GROUPS} /></TabsContent><TabsContent value="primitives" className="tab-panel pt-4"><TokenGroups groups={PRIMITIVE_GROUPS} /></TabsContent></ShadcnTabs>;
}

// The active and legacy previews both consume this shared color-tab renderer.
const TOKEN_COLORS = { map: <T,>(_render: (value: readonly [string, string], index: number, values: ReadonlyArray<readonly [string, string]>) => T): ReactNode => <ColorTokenTabs /> };

function LegacyDesignSystemView({ onBack }: { onBack: () => void }) {
  const [previewToggle, setPreviewToggle] = useState(true);
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-ink-950 px-6 pb-32 pt-8 text-text sm:px-8"><div className="mx-auto max-w-5xl"><header className="mb-10"><Button variant="quiet" size="compact" onClick={onBack}>← SETTINGS</Button><h1 className="mt-6 text-title font-semibold tracking-display">Design system</h1><p className="mt-4 max-w-xl text-body text-text-muted">A Swiss-inspired, outdoor map instrument: high-contrast, deliberately quiet, and built for reliable use on the move.</p></header>
    <div className="grid gap-8 lg:grid-cols-2"><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TYPE SCALE / GEIST</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="text-title font-medium tracking-display">Navigate clearly</p><code className="mt-2 block font-mono text-label text-text-subtle">text-title · 38–64px · lh 0.95</code></div><div className="p-4"><p className="text-subheading font-medium tracking-subheading">Outdoor map instrument</p><code className="mt-2 block font-mono text-label text-text-subtle">text-subheading · 28px · lh 1.05</code></div><div className="p-4"><p className="text-heading font-medium tracking-heading">Section heading</p><code className="mt-2 block font-mono text-label text-text-subtle">text-heading · 22px · lh 1.15</code></div><div className="p-4"><p className="text-body-lg">Larger supporting copy for a key message or longer orientation statement.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body-lg · 16px · lh 1.5</code></div><div className="p-4"><p className="text-body">Legible descriptions are built for planning before a ride and checking a route at a glance.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body · 14px · lh 1.55</code></div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MONOSPACE / GEIST MONO</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="font-mono text-mono-display font-semibold tracking-mono-display">47.2%</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-display · 28–40px · lh 1.05</code></div><div className="p-4"><p className="font-mono text-mono-heading font-semibold tracking-mono-heading">Norrmalm / ready</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-heading · 20px · lh 1.2</code></div><div className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">Norrmalm / 47.2% discovered</p><code className="mt-2 block font-mono text-label text-text-subtle">text-data · 14px · lh 1.35</code></div><div className="p-4"><p className="font-mono text-label font-semibold tracking-[0.14em]">Map display</p><code className="mt-2 block font-mono text-label text-text-subtle">text-label · 12px · lh 1.25</code></div><div className="p-4"><p className="font-mono text-overline font-semibold uppercase tracking-[0.16em]">Roam / Settings / System</p><code className="mt-2 block font-mono text-label text-text-subtle">text-overline · 12px · lh 1.2 · all caps</code></div></Surface></div></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SEMANTIC COLOURS</p><Surface className="p-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{TOKEN_COLORS.map(([name, color]) => <div key={name} className="min-w-0"><div className={`h-12 rounded-control border border-white/10 ${color}`} /><p className="mt-2 truncate font-mono text-label text-text-muted">{name}</p></div>)}</div></Surface></div></div>
    <div className="mt-8 grid gap-8 lg:grid-cols-[1.15fr_0.85fr]"><div className="space-y-8">
      <div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">COMPONENTS</p><Surface className="space-y-5 p-4"><div className="flex flex-wrap gap-3"><Button>START SESSION</Button><Button variant="secondary">VIEW PROGRESS</Button><Button variant="quiet">CANCEL</Button><Button disabled>UNAVAILABLE</Button></div><div className="flex items-center gap-3 border-t border-border pt-5"><IconButton label="Locate rider">●</IconButton><IconButton label="Zoom in" variant="quiet">+</IconButton><IconButton label="Map layers">▦</IconButton></div><div className="border-t border-border pt-4"><Toggle label="DISCOVERED NETWORK" description="Highlight roads and paths you have uncovered." value={previewToggle} onChange={setPreviewToggle} /></div></Surface></div></div>
      <aside className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SPACING & SHAPE</p><Surface className="space-y-5 p-4">{[['space-1', '4px', 16], ['space-2', '8px', 32], ['space-3', '12px', 48], ['space-4', '16px', 64], ['space-6', '24px', 96], ['space-8', '32px', 128]].map(([name, value, width]) => <div key={name}><div className="mb-2 flex justify-between font-mono text-label text-text-subtle"><span>{name}</span><span>{value}</span></div><div className="h-2 rounded-pill bg-accent" style={{ width: `${width}px` }} /></div>)}<div className="grid grid-cols-5 gap-2 border-t border-border-muted pt-5"><div><div className="h-12 rounded-none bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">0px</p></div><div><div className="h-12 rounded-tight bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">4px</p></div><div><div className="h-12 rounded-control bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">8px</p></div><div><div className="h-12 rounded-panel bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">12px</p></div><div><div className="h-12 rounded-pill bg-surface-interactive" /><p className="mt-2 font-mono text-overline text-text-subtle">pill</p></div></div></Surface></div>
        <div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ACCESSIBILITY BASELINE</p><Surface className="space-y-3 p-4 text-body text-text-muted"><p><span className="font-mono text-data font-semibold text-location-200">44px</span> minimum interactive target.</p><p><span className="font-mono text-data font-semibold text-location-200">3px</span> visible focus ring with offset.</p><p><span className="font-mono text-data font-semibold text-location-200">Sans</span> for UI reading; mono reserved for compact data labels.</p></Surface></div>
        <div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MOTION</p><Surface className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">ease-outdoor</p><p className="mt-2 text-label text-text-muted">cubic-bezier(0.16, 1, 0.3, 1) · 150ms default</p><div className="mt-4 h-2 w-full rounded-pill bg-surface-interactive"><div className="h-2 w-2/3 rounded-pill bg-location-500 transition-all duration-150 ease-outdoor hover:w-full" /></div></Surface></div>
      </aside></div></div></section>;
}

function LegacyDesignSystemViewCurrent({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<'foundations' | 'components'>('foundations');
  const [previewToggle, setPreviewToggle] = useState(true);
  const tabs = [{ value: 'foundations', label: 'FOUNDATIONS' }, { value: 'components', label: 'COMPONENTS' }] as const;
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-ink-950 px-6 pb-32 pt-8 text-text sm:px-8"><div className="mx-auto max-w-5xl"><header className="mb-8"><Button variant="quiet" size="compact" onClick={onBack}>← SETTINGS</Button><h1 className="mt-6 text-title font-semibold tracking-display">Design system</h1><p className="mt-4 max-w-xl text-body text-text-muted">A Swiss-inspired outdoor map instrument: high-contrast, deliberately quiet, and built for reliable use on the move.</p></header><Tabs items={tabs} value={activeTab} onChange={setActiveTab} />
    {activeTab === 'foundations' ? <div className="mt-8 space-y-8"><div className="grid items-start gap-8 lg:grid-cols-2"><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TYPE SCALE / GEIST</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="text-subheading font-medium tracking-subheading">Outdoor map instrument</p><code className="mt-2 block font-mono text-label text-text-subtle">text-subheading · 28px · lh 1.05</code></div><div className="p-4"><p className="text-heading font-medium tracking-heading">Section heading</p><code className="mt-2 block font-mono text-label text-text-subtle">text-heading · 22px · lh 1.15</code></div><div className="p-4"><p className="text-body-lg">Larger supporting copy for a key message or longer orientation statement.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body-lg · 16px · lh 1.5</code></div><div className="p-4"><p className="text-body">Legible descriptions are built for planning before a ride and checking a route at a glance.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body · 14px · lh 1.55</code></div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MONOSPACE / GEIST MONO</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="font-mono text-mono-display font-semibold tracking-mono-display">47.2%</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-display · 28–40px · lh 1.05</code></div><div className="p-4"><p className="font-mono text-mono-heading font-semibold tracking-mono-heading">Norrmalm / ready</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-heading · 20px · lh 1.2</code></div><div className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">Norrmalm / 47.2% discovered</p><code className="mt-2 block font-mono text-label text-text-subtle">text-data · 14px · lh 1.35</code></div><div className="p-4"><p className="font-mono text-label font-semibold tracking-[0.14em]">Map display</p><code className="mt-2 block font-mono text-label text-text-subtle">text-label · 12px · lh 1.25</code></div><div className="p-4"><p className="font-mono text-overline font-semibold uppercase tracking-[0.16em]">Roam / Settings / System</p><code className="mt-2 block font-mono text-label text-text-subtle">text-overline · 12px · lh 1.2 · all caps</code></div></Surface></div></div><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SEMANTIC COLOURS</p><Surface className="p-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{TOKEN_COLORS.map(([name, color]) => <div key={name} className="min-w-0"><div className={`h-12 rounded-control border border-white/10 ${color}`} /><p className="mt-2 truncate font-mono text-label text-text-muted">{name}</p></div>)}</div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SPACING & SHAPE</p><Surface className="space-y-4 p-4">{[['space-1', '4px', 16], ['space-2', '8px', 32], ['space-3', '12px', 48], ['space-4', '16px', 64], ['space-6', '24px', 96], ['space-8', '32px', 128]].map(([name, value, width]) => <div key={name}><div className="mb-2 flex justify-between font-mono text-label text-text-subtle"><span>{name}</span><span>{value}</span></div><div className="h-2 rounded-pill bg-accent" style={{ width: `${width}px` }} /></div>)}<div className="grid grid-cols-5 gap-2 border-t border-border-muted pt-4">{[['rounded-none', '0px'], ['rounded-tight', '4px'], ['rounded-control', '8px'], ['rounded-panel', '12px'], ['rounded-pill', 'pill']].map(([radius, label]) => <div key={radius}><div className={`h-10 bg-surface-interactive ${radius}`} /><p className="mt-2 font-mono text-overline text-text-subtle">{label}</p></div>)}</div></Surface></div></div></div><div className="grid gap-8 lg:grid-cols-2"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ACCESSIBILITY BASELINE</p><Surface className="space-y-3 p-4 text-body text-text-muted"><p><span className="font-mono text-data font-semibold text-location-200">44px</span> minimum interactive target.</p><p><span className="font-mono text-data font-semibold text-location-200">3px</span> visible focus ring with offset.</p><p><span className="font-mono text-data font-semibold text-location-200">Geist</span> for UI reading; mono reserved for compact data.</p></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MOTION</p><Surface className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">ease-outdoor</p><p className="mt-2 text-body text-text-muted">cubic-bezier(0.16, 1, 0.3, 1) · 150ms default</p><div className="mt-4 h-2 w-full rounded-pill bg-surface-interactive"><div className="h-2 w-2/3 rounded-pill bg-location-500 transition-all duration-150 ease-outdoor hover:w-full" /></div></Surface></div></div></div> : <div className="mt-8 grid gap-8 lg:grid-cols-2"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">BUTTONS</p><Surface className="space-y-5 p-4"><div className="flex flex-wrap gap-3"><Button>START SESSION</Button><Button variant="secondary">VIEW PROGRESS</Button><Button variant="quiet">CANCEL</Button><Button disabled>UNAVAILABLE</Button></div><p className="border-t border-border-muted pt-4 text-body text-text-muted">Hover elevates contrast; press uses the route accent; disabled controls preserve the layout without relying on opacity alone.</p><div className="flex items-center gap-3 border-t border-border-muted pt-4"><IconButton label="Locate rider">●</IconButton><IconButton label="Zoom in" variant="quiet">+</IconButton><IconButton label="Map layers">▦</IconButton></div></Surface></div><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TOGGLE</p><Surface className="p-4"><Toggle label="DISCOVERED NETWORK" description="Highlight roads and paths you have uncovered." value={previewToggle} onChange={setPreviewToggle} /></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TABS</p><Surface className="p-4"><p className="mb-4 text-body text-text-muted">A compact section switcher with a persistent active indicator and keyboard-accessible tab semantics.</p><Tabs items={tabs} value={activeTab} onChange={setActiveTab} /></Surface></div></div></div>}</div></section>;
}

function LegacyDesignSystemViewActive({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<'foundations' | 'components'>('foundations');
  const [previewToggle, setPreviewToggle] = useState(true);
  const variants = [
    ['Primary', 'primary'],
    ['Secondary', 'secondary'],
    ['Ghost', 'ghost'],
    ['Destructive', 'destructive'],
    ['Disabled', 'primary'],
  ] as const;

  const buttonCell = (variant: 'primary' | 'secondary' | 'ghost' | 'destructive', disabled: boolean, content: ReactNode) => (
    <ShadcnButton variant={variant} disabled={disabled} className="w-full">{content}</ShadcnButton>
  );

  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-ink-950 px-6 pb-32 pt-8 text-text sm:px-8"><div className="mx-auto max-w-5xl">
    <header className="mb-8"><Button variant="quiet" size="compact" onClick={onBack}>← Settings</Button><h1 className="mt-6 text-title font-semibold tracking-display">Design system</h1><p className="mt-4 max-w-xl text-body text-text-muted">A Swiss-inspired outdoor map instrument: high contrast, deliberately quiet, and built for reliable use on the move.</p></header>
    <ShadcnTabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'foundations' | 'components')}>
      <TabsList variant="line" aria-label="Design system sections"><TabsTrigger value="foundations">Foundations</TabsTrigger><TabsTrigger value="components">Components</TabsTrigger></TabsList>
      <TabsContent value="foundations" className="tab-panel mt-8 space-y-8">
        <div className="grid items-start gap-8 lg:grid-cols-2"><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TYPE SCALE / GEIST</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="text-subheading font-medium tracking-subheading">Outdoor map instrument</p><code className="mt-2 block font-mono text-label text-text-subtle">text-subheading · 28px · lh 1.05</code></div><div className="p-4"><p className="text-heading font-medium tracking-heading">Section heading</p><code className="mt-2 block font-mono text-label text-text-subtle">text-heading · 22px · lh 1.15</code></div><div className="p-4"><p className="text-body-lg">Larger supporting copy for a key message or longer orientation statement.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body-lg · 16px · lh 1.5</code></div><div className="p-4"><p className="text-body">Legible descriptions are built for planning before a ride and checking a route at a glance.</p><code className="mt-2 block font-mono text-label text-text-subtle">text-body · 14px · lh 1.55</code></div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MONOSPACE / GEIST MONO</p><Surface className="divide-y divide-border-muted"><div className="p-4"><p className="font-mono text-mono-display font-semibold tracking-mono-display">47.2%</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-display · 28–40px · lh 1.05</code></div><div className="p-4"><p className="font-mono text-mono-heading font-semibold tracking-mono-heading">Norrmalm / ready</p><code className="mt-2 block font-mono text-label text-text-subtle">text-mono-heading · 20px · lh 1.2</code></div><div className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">Norrmalm / 47.2% discovered</p><code className="mt-2 block font-mono text-label text-text-subtle">text-data · 14px · lh 1.35</code></div><div className="p-4"><p className="font-mono text-label font-semibold tracking-[0.14em]">Map display</p><code className="mt-2 block font-mono text-label text-text-subtle">text-label · 12px · lh 1.25</code></div><div className="p-4"><p className="font-mono text-overline font-semibold uppercase tracking-[0.16em]">Roam / Settings / System</p><code className="mt-2 block font-mono text-label text-text-subtle">text-overline · 12px · lh 1.2 · all caps</code></div></Surface></div></div><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SEMANTIC COLOURS</p><Surface className="p-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{TOKEN_COLORS.map(([name, color]) => <div key={name} className="min-w-0"><div className={`h-12 rounded-control border border-white/10 ${color}`} /><p className="mt-2 truncate font-mono text-label text-text-muted">{name}</p></div>)}</div></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SPACING & SHAPE</p><Surface className="space-y-4 p-4">{[['space-1', '4px', 16], ['space-2', '8px', 32], ['space-3', '12px', 48], ['space-4', '16px', 64], ['space-6', '24px', 96], ['space-8', '32px', 128]].map(([name, value, width]) => <div key={name}><div className="mb-2 flex justify-between font-mono text-label text-text-subtle"><span>{name}</span><span>{value}</span></div><div className="h-2 rounded-pill bg-accent" style={{ width: `${width}px` }} /></div>)}<div className="grid grid-cols-5 gap-2 border-t border-border-muted pt-4">{[['rounded-none', '0px'], ['rounded-tight', '4px'], ['rounded-control', '8px'], ['rounded-panel', '12px'], ['rounded-pill', 'pill']].map(([radius, label]) => <div key={radius}><div className={`h-10 bg-surface-interactive ${radius}`} /><p className="mt-2 font-mono text-overline text-text-subtle">{label}</p></div>)}</div></Surface></div></div></div>
        <div className="grid gap-8 lg:grid-cols-2"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ACCESSIBILITY BASELINE</p><Surface className="space-y-3 p-4 text-body text-text-muted"><p><span className="font-mono text-data font-semibold text-location-200">44px</span> minimum interactive target.</p><p><span className="font-mono text-data font-semibold text-location-200">3px</span> visible focus ring with offset.</p><p><span className="font-mono text-data font-semibold text-location-200">Geist</span> for UI reading; mono reserved for compact data.</p></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">MOTION</p><Surface className="p-4"><p className="font-mono text-data font-semibold tracking-[0.08em]">ease-outdoor</p><p className="mt-2 text-body text-text-muted">cubic-bezier(0.16, 1, 0.3, 1) · 150ms default</p><div className="mt-4 h-2 w-full rounded-pill bg-surface-interactive"><div className="h-2 w-2/3 rounded-pill bg-location-500 transition-all duration-150 ease-outdoor hover:w-full" /></div></Surface></div></div>
      </TabsContent>
      <TabsContent value="components" className="tab-panel mt-8 space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">BUTTON MATRIX</p><Surface className="overflow-x-auto p-4"><p className="mb-5 text-body text-text-muted">shadcn Button variants use Roam colour, spacing, type and radius tokens. Hover, pressed and disabled states are built into each source variant.</p><div className="min-w-[720px] overflow-hidden rounded-panel border border-border-muted"><div className="grid grid-cols-[110px_repeat(4,minmax(130px,1fr))] text-center"><div className="border-b border-border-muted p-3 text-left font-mono text-label text-text-subtle">Variant</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Text</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Left icon</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Right icon</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Spinner</div>{variants.flatMap(([label, variant]) => { const disabled = label === 'Disabled'; return [<div key={`${label}-label`} className="flex items-center border-b border-border-muted p-3 text-left font-mono text-label text-text-subtle">{label}</div>, <div key={`${label}-text`} className="border-b border-border-muted p-2">{buttonCell(variant, disabled, 'Continue')}</div>, <div key={`${label}-left`} className="border-b border-border-muted p-2">{buttonCell(variant, disabled, <><span data-icon="inline-start" aria-hidden="true">←</span>Continue</>)}</div>, <div key={`${label}-right`} className="border-b border-border-muted p-2">{buttonCell(variant, disabled, <>Continue<span data-icon="inline-end" aria-hidden="true">→</span></>)}</div>, <div key={`${label}-spinner`} className="border-b border-border-muted p-2">{buttonCell(variant, disabled, <><Spinner />Continue</>)}</div>]; })}</div></div></Surface></div>
        <div className="grid gap-8 lg:grid-cols-2"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ICON BUTTON MATRIX</p><Surface className="space-y-5 overflow-x-auto p-4"><div className="grid min-w-[520px] grid-cols-[110px_repeat(5,1fr)] overflow-hidden rounded-panel border border-border-muted text-center"><div className="border-b border-border-muted p-3 text-left font-mono text-label text-text-subtle">Variant</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Primary</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Secondary</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Ghost</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Destructive</div><div className="border-b border-border-muted p-3 text-body text-text-muted">Disabled</div><div className="flex items-center border-b border-border-muted p-3 text-left font-mono text-label text-text-subtle">Icon button</div>{(['primary', 'secondary', 'ghost', 'destructive'] as const).map((variant, index) => <div key={variant} className="flex justify-center border-b border-border-muted p-2"><ShadcnButton variant={variant} size="icon" aria-label={`${variant} icon button`}>{['●', '+', '▦', '×'][index]}</ShadcnButton></div>)}<div className="flex justify-center border-b border-border-muted p-2"><ShadcnButton variant="primary" size="icon" disabled aria-label="Disabled icon button">●</ShadcnButton></div></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">BUTTON GROUP</p><ButtonGroup><ShadcnButton variant="secondary">Day</ShadcnButton><ShadcnButton variant="secondary">Week</ShadcnButton><ShadcnButton variant="secondary">Month</ShadcnButton></ButtonGroup></div></Surface></div><div className="space-y-8"><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">SWITCH</p><Surface className="flex min-h-control items-center justify-between gap-4 p-4"><span><span className="block text-body-lg font-medium">Discovered network</span><span className="mt-1 block text-body text-text-subtle">Highlight roads and paths you have uncovered.</span></span><Switch checked={previewToggle} onCheckedChange={setPreviewToggle} aria-label="Toggle discovered network" /></Surface></div><div><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">TABS / LINE</p><Surface className="p-4"><p className="mb-4 text-body text-text-muted">The line variant keeps the active bar exactly as wide as its label and uses a short content transition.</p><ShadcnTabs defaultValue="routes"><TabsList variant="line"><TabsTrigger value="routes">Routes</TabsTrigger><TabsTrigger value="saved">Saved places</TabsTrigger></TabsList><TabsContent value="routes" className="tab-panel pt-4 text-body text-text-muted">Your active routes appear here.</TabsContent><TabsContent value="saved" className="tab-panel pt-4 text-body text-text-muted">Your saved places appear here.</TabsContent></ShadcnTabs></Surface></div></div></div>
      </TabsContent>
    </ShadcnTabs>
  </div></section>;
}

function DesignSystemView({ onBack }: { onBack: () => void }) {
  return <><LegacyDesignSystemViewActive onBack={onBack} /><section className="min-h-[calc(100svh-76px)] bg-ink-950 px-6 pb-32 pt-8 text-text sm:px-8"><div className="mx-auto max-w-5xl"><p className="mb-3 font-mono text-label font-semibold tracking-[0.14em] text-text-subtle">ITEM</p><Surface className="max-w-2xl p-4"><div className="space-y-3"><Item variant="outline"><ItemContent><ItemTitle>Map display</ItemTitle><ItemDescription>Show buildings and terrain context while exploring.</ItemDescription></ItemContent><Switch checked aria-label="Map display preview" /></Item><Item variant="muted"><ItemContent><ItemTitle>Developer tools</ItemTitle><ItemDescription>Keep diagnostic controls available for this preview.</ItemDescription></ItemContent><ItemActions><ShadcnButton variant="secondary" size="sm">Open</ShadcnButton></ItemActions></Item></div></Surface></div></section></>;
}

function SettingsView({ showDiscovered, setShowDiscovered, showDistrictBoundaries, setShowDistrictBoundaries, showBuildings3D, setShowBuildings3D, showTerrain3D, setShowTerrain3D, showDebugMenu, setShowDebugMenu, gpsEnabled, gpsPermission, onGpsChange, onOpenDesignSystem }: { showDiscovered: boolean; setShowDiscovered: (value: boolean) => void; showDistrictBoundaries: boolean; setShowDistrictBoundaries: (value: boolean) => void; showBuildings3D: boolean; setShowBuildings3D: (value: boolean) => void; showTerrain3D: boolean; setShowTerrain3D: (value: boolean) => void; showDebugMenu: boolean; setShowDebugMenu: (value: boolean) => void; gpsEnabled: boolean; gpsPermission: GpsPermission; onGpsChange: (value: boolean) => void; onOpenDesignSystem: () => void }) {
  const gpsDescription = gpsPermission === 'denied' ? 'Location access was denied. Enable it in browser settings to retry.' : 'Show your live position on the map.';
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-2xl"><header className="mb-10"><h1 className="font-sans text-title font-semibold tracking-display">Settings</h1><p className="mt-4 max-w-xl text-body-lg text-text-muted">Shape the map to match how you explore. Changes apply immediately.</p></header><div className="space-y-8"><section className="rounded-panel border border-border bg-surface-raised px-4"><p className="-mx-4 border-b border-border-muted px-4 py-3 font-mono text-overline font-semibold tracking-[0.14em] text-accent">MAP DISPLAY</p><SettingToggle label="BUILDINGS 3D" description="Show building massing above the map." value={showBuildings3D} onChange={setShowBuildings3D} /><SettingToggle label="TERRAIN 3D" description="Show elevation and terrain shading." value={showTerrain3D} onChange={setShowTerrain3D} /><SettingToggle label="DISTRICT BOUNDARIES" description="Show Stockholm district boundaries on the map." value={showDistrictBoundaries} onChange={setShowDistrictBoundaries} /><SettingToggle label="DISCOVERED NETWORK" description="Highlight roads and paths you have uncovered." value={showDiscovered} onChange={setShowDiscovered} /></section><section className="rounded-panel border border-border bg-surface-raised px-4"><p className="-mx-4 border-b border-border-muted px-4 py-3 font-mono text-overline font-semibold tracking-[0.14em] text-accent">PLAYER</p><SettingToggle label="GPS LOCATION" description={gpsDescription} value={gpsEnabled} onChange={onGpsChange} /></section><section className="rounded-panel border border-border bg-surface-raised px-4"><p className="-mx-4 border-b border-border-muted px-4 py-3 font-mono text-overline font-semibold tracking-[0.14em] text-accent">DEVELOPER TOOLS</p><SettingToggle label="DEBUG MENU" description="Show the debug controls on the map." value={showDebugMenu} onChange={setShowDebugMenu} /><ShadcnButton variant="ghost" className="flex min-h-control w-full justify-between rounded-none border-0 bg-transparent px-0 text-left text-text hover:border-transparent hover:bg-surface-interactive hover:text-paper-50" type="button" onClick={onOpenDesignSystem}><span className="flex min-w-0 flex-col items-start gap-1"><strong className="font-mono text-data font-semibold tracking-[0.06em]">DESIGN SYSTEM</strong><small className="text-body text-text-subtle">Preview tokens and reusable interface components.</small></span><b aria-hidden="true" className="font-mono text-data text-accent">→</b></ShadcnButton></section><aside className="rounded-control border-l-2 border-accent bg-accent-muted px-4 py-3"><strong className="block font-mono text-label font-semibold tracking-[0.12em] text-accent">3D VIEW</strong><span className="mt-1 block text-body text-text-muted">Use the 3D button on the map to switch between flat and tilted views.</span></aside></div></div></section>;
}

function PlaceholderView({ title, copy }: { title: string; copy: string }) { return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-2xl"><h1 className="font-sans text-title font-semibold tracking-display">{title}</h1><p className="mt-4 max-w-xl text-body-lg text-text-muted">{copy}</p><Item variant="outline" className="mt-10"><ItemContent><ItemTitle>Module ready</ItemTitle><ItemDescription>The next Sessions build slice will add route history and saved rides.</ItemDescription></ItemContent><ItemActions><span className="font-mono text-label text-accent">NEXT</span></ItemActions></Item></div></section>; }

function ProgressView({ location, discoveries }: { location: LocationState; discoveries: DiscoveredSegment[] }) {
  const currentDistrict = findStockholmDistrict([location.lng, location.lat]);
  const currentArea = `${formatItemText(location.city)} / ${formatItemText(currentDistrict?.name ?? location.region)}`;
  return <section className="min-h-[calc(100svh-76px)] overflow-auto bg-surface px-6 pb-32 pt-10 text-text sm:px-8"><div className="mx-auto max-w-3xl"><header><h1 className="font-sans text-title font-semibold tracking-display">Progress</h1><p className="mt-4 max-w-2xl text-body-lg text-text-muted">All 117 Stockholm districts are cataloged. Track the roads and paths you have uncovered as you explore.</p></header><Item variant="outline" className="mt-10 border-accent bg-accent-muted"><ItemContent><ItemTitle>Current area</ItemTitle><ItemDescription>{currentArea}</ItemDescription></ItemContent><ItemActions><span className="font-mono text-mono-heading font-semibold text-accent">{currentDistrict ? `${progressStatsForDistrict(currentDistrict.id, discoveries).discovered.toFixed(1)}%` : '—'}</span></ItemActions></Item><div className="mt-8 space-y-3">{STOCKHOLM_DISTRICTS.map(district => { const districtDiscoveries = discoveries.filter(segment => segment.regionId === district.id); const discoveredMeters = districtDiscoveries.reduce((total, segment) => total + segment.lengthMeters, 0); const denominator = STOCKHOLM_ROAD_NETWORK_BY_DISTRICT.get(district.id)?.denominators; const stats = progressStatsForDistrict(district.id, discoveries); const current = district.id === currentDistrict?.id; return <Item key={district.id} variant={current ? 'muted' : 'outline'} className={current ? 'border-accent' : ''}><ItemContent><DistrictProgressContent title={formatItemText(district.name)} distance={denominator ? `${formatDistance(bikeableDiscoveredMeters(districtDiscoveries))} / ${formatDistance(bikeableLengthMeters(denominator))}` : 'Network index not yet built'} percentage={denominator ? `${stats.discovered.toFixed(1)}%` : formatDistance(discoveredMeters)} stats={stats} /></ItemContent></Item>; })}</div></div></section>;
}

function PrimaryNavigation({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const activeView = view === 'design-system' ? 'settings' : view;
  const items = [{ value: 'map', icon: MapTrifold, label: 'Map' }, { value: 'sessions', icon: RoadHorizon, label: 'Sessions' }, { value: 'progress', icon: ChartBar, label: 'Progress' }, { value: 'settings', icon: Gear, label: 'Settings' }] as const;
  return <ShadcnTabs value={activeView} onValueChange={(value) => onChange(value as View)} className="bottom-nav"><TabsList variant="line" className="bottom-nav-list" aria-label="Primary navigation">{items.map((item) => { const Icon = item.icon; return <TabsTrigger key={item.value} value={item.value} className="nav-item"><span className="nav-icon" aria-hidden="true"><Icon /></span><span>{item.label}</span></TabsTrigger>; })}</TabsList></ShadcnTabs>;
}

function App() {
  const [view, setView] = useState<View>('map');
  const [progressLocation, setProgressLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const [showDiscovered, setShowDiscovered] = useState(true);
  const [showDistrictBoundaries, setShowDistrictBoundaries] = useState(() => localStorage.getItem(DISTRICT_BOUNDARIES_STORAGE_KEY) !== 'false');
  const [is3D, setIs3D] = useState(true);
  const [showBuildings3D, setShowBuildings3D] = useState(false);
  const [showTerrain3D, setShowTerrain3D] = useState(false);
  const [showDebugMenu, setShowDebugMenu] = useState(true);
  const [gpsPermission, setGpsPermission] = useState<GpsPermission>(() => {
    const stored = localStorage.getItem(GPS_PERMISSION_STORAGE_KEY);
    return stored === 'granted' || stored === 'denied' ? stored : 'prompt';
  });
  const [gpsEnabled, setGpsEnabled] = useState(() => localStorage.getItem(GPS_ENABLED_STORAGE_KEY) === 'true');
  const [sessionActive, setSessionActive] = useState(false);
  const [playerLocation, setPlayerLocation] = useState<PlayerLocation | null>(null);
  const navigationRef = useRef<NavigationState | null>(null);
  const [discoveries, setDiscoveries] = useState<DiscoveredSegment[]>([]);
  const gpsWatchRef = useRef<CallbackID | null>(null);
  useEffect(() => { loadDiscoveredSegments().then(setDiscoveries).catch(() => {}); }, []);
  useEffect(() => {
    // Capacitor exposes Android permissions through its plugin; the browser
    // Permissions API remains useful for keeping the web UI in sync.
    Geolocation.checkPermissions().then((status) => {
      setGpsPermission(status.location === 'granted' ? 'granted' : status.location === 'denied' ? 'denied' : 'prompt');
    }).catch(() => {});
    if (!navigator.permissions?.query) return;
    let permissionStatus: PermissionStatus | null = null;
    navigator.permissions.query({ name: 'geolocation' }).then((status) => {
      permissionStatus = status;
      setGpsPermission(status.state === 'granted' || status.state === 'denied' ? status.state : 'prompt');
      status.onchange = () => setGpsPermission(status.state === 'granted' || status.state === 'denied' ? status.state : 'prompt');
    }).catch(() => {});
    return () => { if (permissionStatus) permissionStatus.onchange = null; };
  }, []);
  useEffect(() => {
    if (!gpsEnabled) {
      if (gpsWatchRef.current !== null) void Geolocation.clearWatch({ id: gpsWatchRef.current });
      gpsWatchRef.current = null;
      if (!gpsEnabled) { navigationRef.current = null; setPlayerLocation(null); }
      return;
    }
    const handlePosition = (position: Position) => {
      setGpsPermission('granted');
      const navigation = nextNavigationState(navigationRef.current, {
        lng: position.coords.longitude,
        lat: position.coords.latitude,
        heading: typeof position.coords.heading === 'number' && Number.isFinite(position.coords.heading) ? position.coords.heading : null,
        speed: typeof position.coords.speed === 'number' && Number.isFinite(position.coords.speed) ? position.coords.speed : null,
        timestamp: position.timestamp,
      });
      navigationRef.current = navigation;
      setPlayerLocation({ ...navigation, accuracy: position.coords.accuracy });
      localStorage.setItem(LAST_MAP_CENTER_STORAGE_KEY, JSON.stringify({ lng: position.coords.longitude, lat: position.coords.latitude, timestamp: position.timestamp }));
    };
    const handleError = (error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === 1) {
        setGpsPermission('denied');
        setGpsEnabled(false);
        localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'denied');
      }
    };
    void Geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 5000, timeout: 15000, minimumUpdateInterval: 5000, interval: 5000 }, (position, error) => {
      if (position) handlePosition(position);
      if (error) handleError(error);
    }).then((watchId) => { gpsWatchRef.current = watchId; }).catch(handleError);
    return () => { if (gpsWatchRef.current !== null) void Geolocation.clearWatch({ id: gpsWatchRef.current }); gpsWatchRef.current = null; };
  }, [gpsEnabled]);
  const handleGpsChange = (enabled: boolean, startBackgroundRide = false) => {
    if (!enabled) {
      setGpsEnabled(false);
      navigationRef.current = null;
      setPlayerLocation(null);
      localStorage.setItem(GPS_ENABLED_STORAGE_KEY, 'false');
      if (Capacitor.isNativePlatform()) void RideTracking.stop().catch(() => {});
      return;
    }
    if (!Capacitor.isNativePlatform()) {
      navigator.geolocation.getCurrentPosition(() => {
        setGpsPermission('granted');
        setGpsEnabled(true);
        localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'granted');
        localStorage.setItem(GPS_ENABLED_STORAGE_KEY, 'true');
        if (startBackgroundRide) void RideTracking.start().catch(() => {});
      }, (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setGpsPermission('denied');
          localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'denied');
          setSessionActive(false);
        }
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
      return;
    }
    void Geolocation.requestPermissions({ permissions: ['location'] }).then((status) => {
      if (status.location !== 'granted') throw new Error('Location permission was not granted');
      return Geolocation.getCurrentPosition({ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    }).then(() => {
      setGpsPermission('granted');
      setGpsEnabled(true);
      localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'granted');
      localStorage.setItem(GPS_ENABLED_STORAGE_KEY, 'true');
      if (startBackgroundRide) void RideTracking.start().catch(() => {});
    }).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: number }).code === 1) {
        setGpsPermission('denied');
        localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'denied');
        setSessionActive(false);
      }
    });
  };
  const handleDistrictBoundariesChange = (visible: boolean) => {
    setShowDistrictBoundaries(visible);
    localStorage.setItem(DISTRICT_BOUNDARIES_STORAGE_KEY, String(visible));
  };
  const handleSessionChange = (active: boolean) => {
    setSessionActive(active);
    handleGpsChange(active, active);
  };
  const openProgress = (location: LocationState) => { setProgressLocation(location); setView('progress'); };
  const handleDiscoveries = (newSegments: DiscoveredSegment[]) => {
    void saveDiscoveredSegments(newSegments).catch(() => {});
    setDiscoveries(current => {
      const known = new Set(current.map(segment => segment.id));
      return [...current, ...newSegments.filter(segment => !known.has(segment.id))];
    });
  };
  return <main className="app-shell"><div className="app-content">{view === 'map' && <MapView onOpenProgress={openProgress} onRequestLocation={() => handleGpsChange(true)} sessionActive={sessionActive} onSessionChange={handleSessionChange} showDiscovered={showDiscovered} setShowDiscovered={setShowDiscovered} showDistrictBoundaries={showDistrictBoundaries} setShowDistrictBoundaries={handleDistrictBoundariesChange} is3D={is3D} setIs3D={setIs3D} showBuildings3D={showBuildings3D} setShowBuildings3D={setShowBuildings3D} showTerrain3D={showTerrain3D} setShowTerrain3D={setShowTerrain3D} showDebugMenu={showDebugMenu} playerLocation={playerLocation} discoveries={discoveries} onDiscoveries={handleDiscoveries} />}{view === 'sessions' && <PlaceholderView title="Sessions" copy="A record of every route you take. Session summaries will live here." />}{view === 'progress' && <ProgressView location={progressLocation} discoveries={discoveries} />}{view === 'settings' && <SettingsView showDiscovered={showDiscovered} setShowDiscovered={setShowDiscovered} showDistrictBoundaries={showDistrictBoundaries} setShowDistrictBoundaries={handleDistrictBoundariesChange} showBuildings3D={showBuildings3D} setShowBuildings3D={setShowBuildings3D} showTerrain3D={showTerrain3D} setShowTerrain3D={setShowTerrain3D} showDebugMenu={showDebugMenu} setShowDebugMenu={setShowDebugMenu} gpsEnabled={gpsEnabled} gpsPermission={gpsPermission} onGpsChange={handleGpsChange} onOpenDesignSystem={() => setView('design-system')} />}{view === 'design-system' && <DesignSystemView onBack={() => setView('settings')} />}</div><PrimaryNavigation view={view} onChange={setView} /></main>;
}

const rootElement = document.getElementById('root')!;
const rootWindow = window as Window & { __roamRoot?: ReturnType<typeof createRoot> };
const root = rootWindow.__roamRoot ?? createRoot(rootElement);
rootWindow.__roamRoot = root;
root.render(<StrictMode><App /></StrictMode>);
