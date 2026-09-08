import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { installNetworkSource, NETWORK_SOURCE } from './network-source';
import { NETWORK_MIN_ZOOM } from './network-tiles';
import { DISCOVERY_RADIUS_METERS, discoverSegments, type DiscoveredSegment, type RoadCandidate } from './discovery';
import { loadDiscoveredSegments, saveDiscoveredSegments } from './discovery-store';
import { findStockholmDistrict, STOCKHOLM_DISTRICTS } from './stockholm-catalog';

type View = 'map' | 'sessions' | 'progress' | 'settings';
type LocationState = { city: string; region: string; lng: number; lat: number };
type GpsPermission = 'prompt' | 'granted' | 'denied';
type PlayerLocation = { lng: number; lat: number; heading: number | null; accuracy: number; timestamp: number };

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const TERRAIN_SOURCE = 'roam-terrain';
const HILLSHADE_SOURCE = 'roam-hillshade';
const TERRAIN_TILEJSON = 'https://tiles.mapterhorn.com/tilejson.json';
const TERRAIN_LOD_LEVELS = 2;
const TERRAIN_TILE_RATIO = 1.5;
const TERRAIN_EXAGGERATION = 1.05;
const ROAD_MIN_ZOOM = 6;
const ROAD_MAX_ZOOM = 24;
const UNPAVED_SURFACES = ['gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'unpaved', 'mud', 'sand', 'grass', 'woodchips', 'pebblestone', 'compacted'];
const PATH_CLASSES = ['cycleway', 'path', 'pedestrian', 'footway', 'track', 'bridleway'];
const LOCAL_STREET_CLASSES = ['minor', 'tertiary', 'secondary', 'residential', 'living_street', 'unclassified'];
const NON_BIKEABLE_ROAD_CLASSES = ['motorway', 'trunk', 'primary'];
const explicitBikeAccessFeature = ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false] as any;
const nonBikeableRoadFeature = ['all', ['!', ['match', ['get', 'class'], PATH_CLASSES, true, false]], ['!', explicitBikeAccessFeature], ['any', ['match', ['get', 'class'], NON_BIKEABLE_ROAD_CLASSES, true, false], ['match', ['get', 'subclass'], ['link'], true, false], ['match', ['get', 'bicycle'], ['no'], true, false], ['match', ['get', 'access'], ['no', 'private'], true, false], ['match', ['get', 'vehicle'], ['no'], true, false], ['match', ['get', 'motor_vehicle'], ['no'], true, false]]] as any;
const DEFAULT_LOCATION: LocationState = { city: 'STOCKHOLM', region: 'SÖDERMALM', lng: 18.0649, lat: 59.3326 };
const GPS_ENABLED_STORAGE_KEY = 'roam.gps.enabled';
const GPS_PERMISSION_STORAGE_KEY = 'roam.gps.permission';
const DISCOVERED_SOURCE = 'roam-discovered-network';

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

function ProgressBar({ stats, className = '' }: { stats: ProgressStats; className?: string }) {
  return <div className={`progress-bar ${className}`}><i className="progress-bar__discovered" style={{ width: `${stats.discovered}%` }}><em className="progress-bar__paved-roads" style={{ width: `${stats.pavedBikeableRoads}%` }} /><em className="progress-bar__paved-cycleways" style={{ width: `${stats.pavedCycleways}%` }} /><em className="progress-bar__unpaved" style={{ width: `${stats.unpavedPaths}%` }} /><em className="progress-bar__footpaths" style={{ width: `${stats.footpaths}%` }} /></i></div>;
}

function styleRoamMap(map: Map, showDiscovered: boolean, is3D: boolean, showBuildings3D: boolean, showTerrain3D: boolean) {
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
      map.setPaintProperty(layer.id, 'line-opacity', isPedestrianFootpath && !showDiscovered ? 0 : ['case', nonBikeableRoadFeature, 0.62, isContextRoad, 0.68, isPath, 0.34, 0.46]);
      map.setPaintProperty(layer.id, 'line-width', isMajor ? ['interpolate', ['linear'], ['zoom'], 6, 1.2, 10, 1.5, 15, 6.5, 18, 12] : isPath ? ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 1.7, 15, 3.2, 18, 5] : ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 15, 3.5, 18, 7]);
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
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 1.7, 15, 3.2, 18, 5],
      },
    });
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
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.4, 10, 1.7, 15, 3.2, 18, 5],
      },
      layout: { visibility: showDiscovered ? 'visible' : 'none' },
    } as any);
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
  const roadClass = String(properties.class ?? '');
  const subclass = String(properties.subclass ?? '');
  const surface = String(properties.surface ?? '');
  if (roadClass === 'cycleway' || subclass === 'cycleway') return 'cycleway' as const;
  if (roadClass === 'footway' || roadClass === 'pedestrian') return 'footpath' as const;
  if (PATH_CLASSES.includes(roadClass)) return UNPAVED_SURFACES.includes(surface) ? 'unpaved-path' as const : 'footpath' as const;
  return 'paved-road' as const;
}

function isDiscoverableFeature(properties: Record<string, unknown>) {
  const roadClass = String(properties.class ?? '');
  const bicycle = String(properties.bicycle ?? '');
  const access = String(properties.access ?? '');
  const vehicle = String(properties.vehicle ?? '');
  const motorVehicle = String(properties.motor_vehicle ?? '');
  if (roadClass === 'parking_aisle' || roadClass === 'service' || bicycle === 'no' || access === 'no' || access === 'private' || vehicle === 'no' || motorVehicle === 'no') return false;
  if (PATH_CLASSES.includes(roadClass)) return ['yes', 'designated', 'permissive'].includes(bicycle) || ['yes', 'designated', 'permissive'].includes(String(properties.foot)) || roadClass === 'cycleway';
  return LOCAL_STREET_CLASSES.includes(roadClass);
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
        const geometryKey = coordinates.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
        const sourceId = feature.id ?? properties.osm_id ?? properties.id ?? geometryKey;
        candidates.push({ id: `${sourceId}-${part}-${geometryKey}`, geometry: { type: 'LineString', coordinates }, roadType: roadTypeForFeature(properties) });
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

function MapCanvas({ mapRef, showDiscovered, is3D, showBuildings3D, showTerrain3D, playerLocation, discoveries, onDiscoveries, onLocationChange, onBearingChange, onZoomChange }: { mapRef: React.MutableRefObject<Map | null>; showDiscovered: boolean; is3D: boolean; showBuildings3D: boolean; showTerrain3D: boolean; playerLocation: PlayerLocation | null; discoveries: DiscoveredSegment[]; onDiscoveries: (segments: DiscoveredSegment[]) => void; onLocationChange: (lng: number, lat: number, locality?: { city?: string; region?: string }) => void; onBearingChange: (bearing: number) => void; onZoomChange: (zoom: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerMarkerRef = useRef<maplibregl.Marker | null>(null);
  const centeredOnPlayerRef = useRef(false);
  const discoveriesRef = useRef(discoveries);
  const [mapReady, setMapReady] = useState(false);
  const [networkRevision, setNetworkRevision] = useState(0);
  useEffect(() => { discoveriesRef.current = discoveries; }, [discoveries]);
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: [18.0649, 59.3326], zoom: 14, pitch: 42, bearing: -12, maxPitch: 70, attributionControl: false, canvasContextAttributes: { antialias: true, powerPreference: 'high-performance' } });
    mapRef.current = map;
    let removeNetworkProtocol = () => {};
    map.on('load', () => {
      removeNetworkProtocol = installNetworkSource(map);
      styleRoamMap(map, showDiscovered, is3D, showBuildings3D, showTerrain3D);
      const center = map.getCenter();
      onLocationChange(center.lng, center.lat, findMapLocality(map));
      onBearingChange(map.getBearing());
      onZoomChange(map.getZoom());
      setMapReady(true);
    });
    map.on('rotate', () => onBearingChange(map.getBearing()));
    map.on('zoom', () => onZoomChange(map.getZoom()));
    map.on('moveend', () => {
      const center = map.getCenter();
      onLocationChange(center.lng, center.lat, findMapLocality(map));
    });
    map.on('idle', () => setNetworkRevision(revision => revision + 1));
    return () => { playerMarkerRef.current?.remove(); playerMarkerRef.current = null; map.remove(); removeNetworkProtocol(); mapRef.current = null; };
  }, [mapRef]);
  useEffect(() => {
    if (mapReady && mapRef.current) styleRoamMap(mapRef.current, showDiscovered, is3D, showBuildings3D, showTerrain3D);
  }, [mapReady, mapRef, showDiscovered, is3D, showBuildings3D, showTerrain3D]);
  useEffect(() => {
    if (mapReady && mapRef.current) {
      styleRoamMap(mapRef.current, showDiscovered, is3D, showBuildings3D, showTerrain3D);
      mapRef.current.easeTo({ pitch: is3D ? 42 : 0, bearing: is3D ? -12 : 0, duration: 450 });
    }
  }, [mapReady, mapRef, is3D, showDiscovered, showBuildings3D, showTerrain3D]);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource(DISCOVERED_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: 'FeatureCollection', features: discoveries.map(segment => ({ type: 'Feature', properties: { roadType: segment.roadType }, geometry: segment.geometry })) } as any);
  }, [discoveries, mapReady, mapRef]);
  useEffect(() => {
    if (!mapReady || !mapRef.current || !playerLocation) return;
    const district = findStockholmDistrict([playerLocation.lng, playerLocation.lat]);
    const newlyDiscovered = discoverSegments(playerLocation, candidatesFromMap(mapRef.current, playerLocation), new Set(discoveriesRef.current.map(segment => segment.id)), district);
    if (!newlyDiscovered.length) return;
    discoveriesRef.current = [...discoveriesRef.current, ...newlyDiscovered];
    onDiscoveries(newlyDiscovered);
  }, [mapReady, mapRef, networkRevision, onDiscoveries, playerLocation]);
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (!playerLocation) {
      playerMarkerRef.current?.remove();
      playerMarkerRef.current = null;
      centeredOnPlayerRef.current = false;
      return;
    }
    if (!playerMarkerRef.current) {
      const element = document.createElement('div');
      element.className = 'player-marker';
      element.setAttribute('aria-label', 'Your current location');
      // addTo immediately projects the marker, so coordinates must exist first.
      playerMarkerRef.current = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([playerLocation.lng, playerLocation.lat])
        .addTo(mapRef.current);
    }
    const marker = playerMarkerRef.current;
    marker.setLngLat([playerLocation.lng, playerLocation.lat]);
    marker.getElement().style.setProperty('--player-heading', `${playerLocation.heading ?? 0}deg`);
    if (!centeredOnPlayerRef.current) {
      mapRef.current.flyTo({ center: [playerLocation.lng, playerLocation.lat], zoom: 15, duration: 700 });
      centeredOnPlayerRef.current = true;
    }
  }, [mapReady, mapRef, playerLocation]);
  return <div className="map-canvas"><div ref={containerRef} className="maplibre-container" /><div className={is3D ? 'map-depth-fade' : 'map-depth-fade map-depth-fade--hidden'} aria-hidden="true" />
    {!mapReady && <div className="map-loading">LOADING ROAD DATA…</div>}
  </div>;
}

function MapView({ onOpenProgress, showDiscovered, setShowDiscovered, is3D, setIs3D, showBuildings3D, setShowBuildings3D, showTerrain3D, setShowTerrain3D, showDebugMenu, playerLocation, discoveries, onDiscoveries }: { onOpenProgress: (location: LocationState) => void; showDiscovered: boolean; setShowDiscovered: (value: boolean) => void; is3D: boolean; setIs3D: (value: boolean) => void; showBuildings3D: boolean; setShowBuildings3D: (value: boolean) => void; showTerrain3D: boolean; setShowTerrain3D: (value: boolean) => void; showDebugMenu: boolean; playerLocation: PlayerLocation | null; discoveries: DiscoveredSegment[]; onDiscoveries: (segments: DiscoveredSegment[]) => void }) {
  const [bearing, setBearing] = useState(-12);
  const [zoom, setZoom] = useState(14);
  const [debugOpen, setDebugOpen] = useState(false);
  const [location, setLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const mapRef = useRef<Map | null>(null);
  const handleLocationChange = (lng: number, lat: number, locality?: { city?: string; region?: string }) => setLocation((current) => ({ ...current, lng, lat, city: locality?.city?.toUpperCase() || current.city, region: locality?.region?.toUpperCase() || current.region }));
  const handleBearingChange = (nextBearing: number) => setBearing((previousBearing) => {
    let adjustedBearing = nextBearing;
    while (adjustedBearing - previousBearing > 180) adjustedBearing -= 360;
    while (adjustedBearing - previousBearing < -180) adjustedBearing += 360;
    return adjustedBearing;
  });
  const summaryWidth = Math.max(190, Math.min(320, 70 + Math.max(location.city.length + location.region.length, 18) * 6));
  const currentDistrict = findStockholmDistrict([location.lng, location.lat]);
  const discoveredMeters = discoveries.filter(segment => segment.regionId === currentDistrict?.id).reduce((total, segment) => total + segment.lengthMeters, 0);
  return <section className="map-view"><MapCanvas mapRef={mapRef} showDiscovered={showDiscovered} is3D={is3D} showBuildings3D={showBuildings3D} showTerrain3D={showTerrain3D} playerLocation={playerLocation} discoveries={discoveries} onDiscoveries={onDiscoveries} onLocationChange={handleLocationChange} onBearingChange={handleBearingChange} onZoomChange={setZoom} />
    <header className="map-header"><span className="map-header-spacer" aria-hidden="true" /><button className="location-summary map-ui-surface" style={{ width: `${summaryWidth}px` }} type="button" onClick={() => onOpenProgress(location)}><strong>{location.city} / {currentDistrict?.name ?? location.region}</strong><ProgressBar stats={CURRENT_PROGRESS} className="summary-progress" /><span>{discoveredMeters > 0 ? `${discoveredMeters} M DISCOVERED` : 'CATALOG READY'}</span></button><span className="map-header-spacer" aria-hidden="true" /></header>
    <div className="map-compass"><button className="map-ui-surface" type="button" aria-label="Reset compass north" onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 450 })}><span className="compass-rotor" style={{ transform: `rotate(${-bearing}deg)` }}><span className="compass-north-label">N</span><i className="compass-needle"><b className="compass-north">▲</b><b className="compass-south">▼</b></i></span></button></div><div className="map-controls" aria-label="Map controls"><button className="map-ui-surface" type="button" aria-label="Center on location" onClick={() => mapRef.current?.flyTo({ center: playerLocation ? [playerLocation.lng, playerLocation.lat] : [18.0649, 59.3326], zoom: playerLocation ? 15 : 14 })}>◎</button><button className="map-ui-surface map-mode-toggle" type="button" aria-label={`Switch to ${is3D ? '2D' : '3D'} view`} onClick={() => setIs3D(!is3D)}>{is3D ? '3D' : '2D'}</button><div className="zoom-group map-ui-surface"><button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button><button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button></div></div>
    {showDebugMenu && <div className="map-debug"><button className="map-ui-surface debug-icon" type="button" aria-label="Open debug settings" aria-expanded={debugOpen} onClick={() => setDebugOpen(!debugOpen)}>⌘</button>{debugOpen && <div className="debug-menu map-ui-surface"><p>DEBUG SETTINGS</p><button type="button" role="switch" aria-checked={showDiscovered} onClick={() => setShowDiscovered(!showDiscovered)}><span>DISCOVERED LAYER</span><b className={showDiscovered ? 'switch switch--on' : 'switch'} aria-hidden="true" /></button><button type="button" role="switch" aria-checked={showBuildings3D} onClick={() => setShowBuildings3D(!showBuildings3D)}><span>BUILDINGS 3D</span><b className={showBuildings3D ? 'switch switch--on' : 'switch'} aria-hidden="true" /></button><button type="button" role="switch" aria-checked={showTerrain3D} onClick={() => setShowTerrain3D(!showTerrain3D)}><span>TERRAIN 3D</span><b className={showTerrain3D ? 'switch switch--on' : 'switch'} aria-hidden="true" /></button><div><span>ZOOM LEVEL</span><b className="debug-value">{zoom.toFixed(1)}</b></div></div>}</div>}
  </section>;
}

function SettingToggle({ label, description, value, onChange }: { label: string; description: string; value: boolean; onChange: (value: boolean) => void }) {
  return <button className="setting-row" type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)}><span><strong>{label}</strong><small>{description}</small></span><b className={value ? 'setting-toggle setting-toggle--on' : 'setting-toggle'}>{value ? 'ON' : 'OFF'}</b></button>;
}

function SettingsView({ showDiscovered, setShowDiscovered, showBuildings3D, setShowBuildings3D, showTerrain3D, setShowTerrain3D, showDebugMenu, setShowDebugMenu, gpsEnabled, gpsPermission, onGpsChange }: { showDiscovered: boolean; setShowDiscovered: (value: boolean) => void; showBuildings3D: boolean; setShowBuildings3D: (value: boolean) => void; showTerrain3D: boolean; setShowTerrain3D: (value: boolean) => void; showDebugMenu: boolean; setShowDebugMenu: (value: boolean) => void; gpsEnabled: boolean; gpsPermission: GpsPermission; onGpsChange: (value: boolean) => void }) {
  const gpsDescription = gpsPermission === 'denied' ? 'Location access was denied. Enable it in browser settings to retry.' : gpsEnabled ? 'Show your live position on the map.' : 'Allow location access to show your position on the map.';
  return <section className="settings-view"><div className="settings-header"><p className="eyebrow">ROAM / SETTINGS</p><h1>Settings</h1><p>Shape the map to match how you explore. Changes apply immediately.</p></div><div className="settings-group"><p className="settings-group-title">MAP DISPLAY</p><SettingToggle label="BUILDINGS 3D" description="Show building massing above the map." value={showBuildings3D} onChange={setShowBuildings3D} /><SettingToggle label="TERRAIN 3D" description="Show elevation and terrain shading." value={showTerrain3D} onChange={setShowTerrain3D} /><SettingToggle label="DISCOVERED NETWORK" description="Highlight roads and paths you have uncovered." value={showDiscovered} onChange={setShowDiscovered} /></div><div className="settings-group"><p className="settings-group-title">PLAYER</p><SettingToggle label="GPS LOCATION" description={gpsDescription} value={gpsEnabled} onChange={onGpsChange} /></div><div className="settings-group"><p className="settings-group-title">DEVELOPER TOOLS</p><SettingToggle label="DEBUG MENU" description="Show the debug controls on the map." value={showDebugMenu} onChange={setShowDebugMenu} /></div><div className="settings-note"><strong>3D VIEW</strong><span>Use the 3D button on the map to switch between flat and tilted views.</span></div></section>;
}

function PlaceholderView({ title, eyebrow, copy }: { title: string; eyebrow: string; copy: string }) { return <section className="placeholder-view"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p><div className="empty-state">MODULE READY<br /><span>Next build slice</span></div></section>; }

function ProgressView({ location, discoveries }: { location: LocationState; discoveries: DiscoveredSegment[] }) {
  const currentDistrict = findStockholmDistrict([location.lng, location.lat]);
  return <section className="progress-view"><div className="progress-header"><p className="eyebrow">ROAM / PROGRESS</p><h1>Progress</h1><p>All 117 Stockholm districts are cataloged. Road-length totals are being indexed before completion percentages are shown.</p></div><div className="progress-current"><span className="progress-label">CURRENT AREA</span><strong>{location.city} / {currentDistrict?.name ?? location.region}</strong></div><div className="progress-areas">{STOCKHOLM_DISTRICTS.map(district => { const discoveredMeters = discoveries.filter(segment => segment.regionId === district.id).reduce((total, segment) => total + segment.lengthMeters, 0); const current = district.id === currentDistrict?.id; return <article className={current ? 'progress-area progress-area--current' : 'progress-area'} key={district.id}><div className="progress-area-top"><div><strong>{district.name}</strong><span>STOCKHOLM</span></div><b>{discoveredMeters} M</b></div><ProgressBar stats={CURRENT_PROGRESS} /><small>{discoveredMeters > 0 ? `${discoveredMeters} M DISCOVERED` : 'NO ROADS DISCOVERED YET'} · NETWORK INDEX PENDING</small></article>; })}</div></section>;
}

function App() {
  const [view, setView] = useState<View>('map');
  const [progressLocation, setProgressLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const [showDiscovered, setShowDiscovered] = useState(true);
  const [is3D, setIs3D] = useState(true);
  const [showBuildings3D, setShowBuildings3D] = useState(false);
  const [showTerrain3D, setShowTerrain3D] = useState(false);
  const [showDebugMenu, setShowDebugMenu] = useState(true);
  const [gpsPermission, setGpsPermission] = useState<GpsPermission>(() => {
    const stored = localStorage.getItem(GPS_PERMISSION_STORAGE_KEY);
    return stored === 'granted' || stored === 'denied' ? stored : 'prompt';
  });
  const [gpsEnabled, setGpsEnabled] = useState(() => localStorage.getItem(GPS_ENABLED_STORAGE_KEY) === 'true');
  const [playerLocation, setPlayerLocation] = useState<PlayerLocation | null>(null);
  const [discoveries, setDiscoveries] = useState<DiscoveredSegment[]>([]);
  const gpsWatchRef = useRef<number | null>(null);
  useEffect(() => { loadDiscoveredSegments().then(setDiscoveries).catch(() => {}); }, []);
  useEffect(() => {
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
    if (!gpsEnabled || !navigator.geolocation) {
      if (gpsWatchRef.current !== null) navigator.geolocation?.clearWatch(gpsWatchRef.current);
      gpsWatchRef.current = null;
      if (!gpsEnabled) setPlayerLocation(null);
      return;
    }
    const handlePosition = (position: GeolocationPosition) => {
      setGpsPermission('granted');
      setPlayerLocation({ lng: position.coords.longitude, lat: position.coords.latitude, heading: Number.isFinite(position.coords.heading) ? position.coords.heading : null, accuracy: position.coords.accuracy, timestamp: position.timestamp });
    };
    const handleError = (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) {
        setGpsPermission('denied');
        setGpsEnabled(false);
        localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'denied');
      }
    };
    gpsWatchRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    return () => { if (gpsWatchRef.current !== null) navigator.geolocation.clearWatch(gpsWatchRef.current); gpsWatchRef.current = null; };
  }, [gpsEnabled]);
  const handleGpsChange = (enabled: boolean) => {
    if (!enabled) {
      setGpsEnabled(false);
      setPlayerLocation(null);
      localStorage.setItem(GPS_ENABLED_STORAGE_KEY, 'false');
      return;
    }
    if (!navigator.geolocation) {
      setGpsPermission('denied');
      return;
    }
    navigator.geolocation.getCurrentPosition(() => {
      setGpsPermission('granted');
      setGpsEnabled(true);
      localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'granted');
      localStorage.setItem(GPS_ENABLED_STORAGE_KEY, 'true');
    }, (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        setGpsPermission('denied');
        localStorage.setItem(GPS_PERMISSION_STORAGE_KEY, 'denied');
      }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
  };
  const openProgress = (location: LocationState) => { setProgressLocation(location); setView('progress'); };
  const handleDiscoveries = (newSegments: DiscoveredSegment[]) => {
    void saveDiscoveredSegments(newSegments).catch(() => {});
    setDiscoveries(current => {
      const known = new Set(current.map(segment => segment.id));
      return [...current, ...newSegments.filter(segment => !known.has(segment.id))];
    });
  };
  return <main className="app-shell"><div className="app-content">{view === 'map' && <MapView onOpenProgress={openProgress} showDiscovered={showDiscovered} setShowDiscovered={setShowDiscovered} is3D={is3D} setIs3D={setIs3D} showBuildings3D={showBuildings3D} setShowBuildings3D={setShowBuildings3D} showTerrain3D={showTerrain3D} setShowTerrain3D={setShowTerrain3D} showDebugMenu={showDebugMenu} playerLocation={playerLocation} discoveries={discoveries} onDiscoveries={handleDiscoveries} />}{view === 'sessions' && <PlaceholderView eyebrow="ROAM / SESSIONS" title="Sessions" copy="A record of every route you take. Session summaries will live here." />}{view === 'progress' && <ProgressView location={progressLocation} discoveries={discoveries} />}{view === 'settings' && <SettingsView showDiscovered={showDiscovered} setShowDiscovered={setShowDiscovered} showBuildings3D={showBuildings3D} setShowBuildings3D={setShowBuildings3D} showTerrain3D={showTerrain3D} setShowTerrain3D={setShowTerrain3D} showDebugMenu={showDebugMenu} setShowDebugMenu={setShowDebugMenu} gpsEnabled={gpsEnabled} gpsPermission={gpsPermission} onGpsChange={handleGpsChange} />}</div><nav className="bottom-nav" aria-label="Primary navigation">{([['map', '◈', 'MAP'], ['sessions', '⌁', 'SESSIONS'], ['progress', '▦', 'PROGRESS'], ['settings', '⚙', 'SETTINGS']] as const).map(([key, icon, label]) => <button key={key} className={view === key ? 'nav-item nav-item--active' : 'nav-item'} onClick={() => setView(key)} type="button"><span className="nav-icon">{icon}</span><span>{label}</span></button>)}</nav></main>;
}

const rootElement = document.getElementById('root')!;
const rootWindow = window as Window & { __roamRoot?: ReturnType<typeof createRoot> };
const root = rootWindow.__roamRoot ?? createRoot(rootElement);
rootWindow.__roamRoot = root;
root.render(<StrictMode><App /></StrictMode>);
