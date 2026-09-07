import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { installNetworkSource, NETWORK_SOURCE } from './network-source';
import { NETWORK_MIN_ZOOM } from './network-tiles';

type View = 'map' | 'sessions' | 'progress';
type LocationState = { city: string; region: string; lng: number; lat: number };

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

const surfaceColor = (pavedColor: string, unpavedColor: string) =>
  ['match', ['get', 'surface'], UNPAVED_SURFACES, unpavedColor, pavedColor] as any;

const cyclewayFeature = ['any', ['match', ['get', 'class'], ['cycleway'], true, false], ['match', ['get', 'subclass'], ['cycleway'], true, false]] as any;
const pathAccessFeature = ['any', cyclewayFeature, ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false], ['match', ['get', 'foot'], ['yes', 'designated', 'permissive'], true, false]] as any;
const networkExclusionFilter = ['all', ['!', nonBikeableRoadFeature], ['!=', ['get', 'class'], 'parking_aisle'], ['!=', ['get', 'class'], 'service']] as any;
const bikeablePathEligibilityFilter = ['all', ['match', ['get', 'class'], PATH_CLASSES, true, false], pathAccessFeature] as any;
const localRoadEligibilityFilter = ['all', ['match', ['get', 'class'], LOCAL_STREET_CLASSES, true, false], ['!=', ['get', 'bicycle'], 'no']] as any;
const bikeablePathFilter = ['all', networkExclusionFilter, bikeablePathEligibilityFilter] as any;
const discoveredNetworkFilter = (includePaths: boolean) => ['all', networkExclusionFilter, ['any', ...(includePaths ? [bikeablePathEligibilityFilter] : []), localRoadEligibilityFilter]] as any;

type ProgressStats = {
  discovered: number;
  pavedBikeableRoads: number;
  pavedCycleways: number;
  unpavedPaths: number;
  footpaths: number;
};

const CURRENT_PROGRESS: ProgressStats = { discovered: 42.8, pavedBikeableRoads: 48, pavedCycleways: 13, unpavedPaths: 24, footpaths: 15 };

function ProgressBar({ stats, className = '' }: { stats: ProgressStats; className?: string }) {
  return <div className={`progress-bar ${className}`}><i className="progress-bar__discovered" style={{ width: `${stats.discovered}%` }}><em className="progress-bar__paved-roads" style={{ width: `${stats.pavedBikeableRoads}%` }} /><em className="progress-bar__paved-cycleways" style={{ width: `${stats.pavedCycleways}%` }} /><em className="progress-bar__unpaved" style={{ width: `${stats.unpavedPaths}%` }} /><em className="progress-bar__footpaths" style={{ width: `${stats.footpaths}%` }} /></i></div>;
}

function styleRoamMap(map: Map, showDiscovered: boolean, is3D: boolean, showBuildings3D: boolean, showTerrain3D: boolean) {
  const layers = map.getStyle().layers ?? [];
  const firstRoadLayer = layers.find((layer) => layer.type === 'line' && ('source-layer' in layer ? layer['source-layer'] === 'transportation' : false))?.id;
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
  if (map.getSource('openmaptiles') && !map.getLayer('roam-discovered-network')) {
    map.addLayer({
      id: 'roam-discovered-network',
      type: 'line',
      minzoom: ROAD_MIN_ZOOM,
      maxzoom: ROAD_MAX_ZOOM,
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: discoveredNetworkFilter(true),
      paint: {
        'line-color': ['case', ['any', ['match', ['get', 'class'], ['cycleway'], true, false], ['match', ['get', 'subclass'], ['cycleway'], true, false]], ['match', ['get', 'surface'], UNPAVED_SURFACES, '#d59c67', '#2bb8b0'], ['match', ['get', 'surface'], UNPAVED_SURFACES, '#d59c67', '#f0eee7']],
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
  if (map.getLayer('roam-buildings-3d')) map.setLayoutProperty('roam-buildings-3d', 'visibility', is3D && showBuildings3D ? 'visible' : 'none');
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
  if (map.getLayer('roam-discovered-network')) {
    map.setLayoutProperty('roam-discovered-network', 'visibility', showDiscovered ? 'visible' : 'none');
  }
  // Keep the existing generalized overview below z12; use the same filters and
  // paints against complete z14 geometry at useful cycling zooms.
  if (map.getSource(NETWORK_SOURCE)) {
    for (const id of ['roam-bikeable-paths', 'roam-discovered-network']) {
      const detailId = `${id}-detail`;
      if (!map.getLayer(detailId)) {
        const original = map.getStyle().layers.find(layer => layer.id === id);
        if (original?.type === 'line') {
          map.addLayer({ ...original, id: detailId, source: NETWORK_SOURCE, minzoom: NETWORK_MIN_ZOOM }, id);
          map.setLayerZoomRange(id, ROAD_MIN_ZOOM, NETWORK_MIN_ZOOM);
        }
      }
    }
    if (map.getLayer('roam-discovered-network-detail')) {
      map.setLayoutProperty('roam-discovered-network-detail', 'visibility', showDiscovered ? 'visible' : 'none');
    }
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

function MapCanvas({ mapRef, showDiscovered, is3D, showBuildings3D, showTerrain3D, onLocationChange, onBearingChange, onZoomChange }: { mapRef: React.MutableRefObject<Map | null>; showDiscovered: boolean; is3D: boolean; showBuildings3D: boolean; showTerrain3D: boolean; onLocationChange: (lng: number, lat: number, locality?: { city?: string; region?: string }) => void; onBearingChange: (bearing: number) => void; onZoomChange: (zoom: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
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
    return () => { map.remove(); removeNetworkProtocol(); mapRef.current = null; };
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
  return <div className="map-canvas"><div ref={containerRef} className="maplibre-container" /><div className={is3D ? 'map-depth-fade' : 'map-depth-fade map-depth-fade--hidden'} aria-hidden="true" />
    {!mapReady && <div className="map-loading">LOADING ROAD DATA…</div>}
  </div>;
}

function MapView({ onOpenProgress }: { onOpenProgress: (location: LocationState) => void }) {
  const [showDiscovered, setShowDiscovered] = useState(true);
  const [is3D, setIs3D] = useState(true);
  const [showBuildings3D, setShowBuildings3D] = useState(false);
  const [showTerrain3D, setShowTerrain3D] = useState(false);
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
  return <section className="map-view"><MapCanvas mapRef={mapRef} showDiscovered={showDiscovered} is3D={is3D} showBuildings3D={showBuildings3D} showTerrain3D={showTerrain3D} onLocationChange={handleLocationChange} onBearingChange={handleBearingChange} onZoomChange={setZoom} />
    <header className="map-header"><span className="map-header-spacer" aria-hidden="true" /><button className="location-summary map-ui-surface" style={{ width: `${summaryWidth}px` }} type="button" onClick={() => onOpenProgress(location)}><strong>{location.city} / {location.region}</strong><ProgressBar stats={CURRENT_PROGRESS} className="summary-progress" /><span>{CURRENT_PROGRESS.discovered.toFixed(1)}% DISCOVERED</span></button><span className="map-header-spacer" aria-hidden="true" /></header>
    <div className="map-compass"><button className="map-ui-surface" type="button" aria-label="Reset compass north" onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 450 })}><span className="compass-rotor" style={{ transform: `rotate(${-bearing}deg)` }}><span className="compass-north-label">N</span><i className="compass-needle"><b className="compass-north">▲</b><b className="compass-south">▼</b></i></span></button></div><div className="map-controls" aria-label="Map controls"><button className="map-ui-surface" type="button" aria-label="Center on location" onClick={() => mapRef.current?.flyTo({ center: [18.0649, 59.3326], zoom: 14 })}>◎</button><button className="map-ui-surface map-mode-toggle" type="button" aria-label={`Switch to ${is3D ? '2D' : '3D'} view`} onClick={() => setIs3D(!is3D)}>{is3D ? '3D' : '2D'}</button><div className="zoom-group map-ui-surface"><button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button><button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button></div></div>
    <div className="map-debug"><button className="map-ui-surface debug-icon" type="button" aria-label="Open debug settings" aria-expanded={debugOpen} onClick={() => setDebugOpen(!debugOpen)}>⌘</button>{debugOpen && <div className="debug-menu map-ui-surface"><p>DEBUG SETTINGS</p><button type="button" onClick={() => setShowDiscovered(!showDiscovered)}><span>DISCOVERED LAYER</span><b>{showDiscovered ? 'ON' : 'OFF'}</b></button><button type="button" onClick={() => setShowBuildings3D(!showBuildings3D)}><span>BUILDINGS 3D</span><b>{showBuildings3D ? 'ON' : 'OFF'}</b></button><button type="button" onClick={() => setShowTerrain3D(!showTerrain3D)}><span>TERRAIN 3D</span><b>{showTerrain3D ? 'ON' : 'OFF'}</b></button><div><span>ROAD FILTER</span><b>BIKEABLE</b></div><div><span>ZOOM LEVEL</span><b>{zoom.toFixed(1)}</b></div></div>}</div>
  </section>;
}

function PlaceholderView({ title, eyebrow, copy }: { title: string; eyebrow: string; copy: string }) { return <section className="placeholder-view"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p><div className="empty-state">MODULE READY<br /><span>Next build slice</span></div></section>; }

function ProgressView({ location }: { location: LocationState }) {
  const areas = [
    { name: location.region, city: location.city, stats: CURRENT_PROGRESS },
    { name: 'Södermalm', city: 'Stockholm', stats: { discovered: 42.8, pavedBikeableRoads: 48, pavedCycleways: 13, unpavedPaths: 24, footpaths: 15 } },
    { name: 'Liljeholmen', city: 'Stockholm', stats: { discovered: 31.4, pavedBikeableRoads: 42, pavedCycleways: 12, unpavedPaths: 31, footpaths: 15 } },
    { name: 'Kungsholmen', city: 'Stockholm', stats: { discovered: 27.9, pavedBikeableRoads: 53, pavedCycleways: 15, unpavedPaths: 18, footpaths: 14 } },
    { name: 'Aspudden', city: 'Stockholm', stats: { discovered: 19.6, pavedBikeableRoads: 36, pavedCycleways: 13, unpavedPaths: 38, footpaths: 13 } },
  ];
  return <section className="progress-view"><div className="progress-header"><p className="eyebrow">ROAM / PROGRESS</p><h1>Progress</h1><p>Explore the bikeable network by neighborhood. Every percentage measures eligible paths uncovered.</p></div><div className="progress-current"><span className="progress-label">CURRENT AREA</span><strong>{location.city} / {location.region}</strong></div><div className="progress-areas">{areas.map((area, index) => <article className={index === 0 ? 'progress-area progress-area--current' : 'progress-area'} key={`${area.city}-${area.name}`}><div className="progress-area-top"><div><strong>{area.name}</strong><span>{area.city}</span></div><b>{area.stats.discovered.toFixed(1)}%</b></div><ProgressBar stats={area.stats} /><small>PAVED BIKEABLE ROADS {area.stats.pavedBikeableRoads}% · PAVED CYCLEWAYS {area.stats.pavedCycleways}% · UNPAVED PATHS {area.stats.unpavedPaths}% · FOOTPATHS {area.stats.footpaths}%</small></article>)}</div></section>;
}

function App() {
  const [view, setView] = useState<View>('map');
  const [progressLocation, setProgressLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const openProgress = (location: LocationState) => { setProgressLocation(location); setView('progress'); };
  return <main className="app-shell"><div className="app-content">{view === 'map' && <MapView onOpenProgress={openProgress} />}{view === 'sessions' && <PlaceholderView eyebrow="ROAM / SESSIONS" title="Sessions" copy="A record of every route you take. Session summaries will live here." />}{view === 'progress' && <ProgressView location={progressLocation} />}</div><nav className="bottom-nav" aria-label="Primary navigation">{([['map', '◈', 'MAP'], ['sessions', '⌁', 'SESSIONS'], ['progress', '▦', 'PROGRESS']] as const).map(([key, icon, label]) => <button key={key} className={view === key ? 'nav-item nav-item--active' : 'nav-item'} onClick={() => setView(key)} type="button"><span className="nav-icon">{icon}</span><span>{label}</span></button>)}</nav></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
