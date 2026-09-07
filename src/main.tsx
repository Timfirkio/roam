import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

type View = 'map' | 'sessions' | 'progress';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const UNPAVED_SURFACES = ['gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'unpaved', 'mud', 'sand', 'grass', 'woodchips', 'pebblestone', 'compacted'];
const PATH_CLASSES = ['cycleway', 'path', 'pedestrian', 'footway', 'track', 'bridleway'];
const LOCAL_STREET_CLASSES = ['minor', 'tertiary', 'secondary', 'residential', 'living_street', 'unclassified'];

const surfaceColor = (pavedColor: string, unpavedColor: string) =>
  ['match', ['get', 'surface'], UNPAVED_SURFACES, unpavedColor, pavedColor] as any;

function styleRoamMap(map: Map, showDiscovered: boolean) {
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
      map.setPaintProperty(layer.id, 'fill-color', '#35191d');
      map.setPaintProperty(layer.id, 'fill-opacity', 0.9);
      map.setPaintProperty(layer.id, 'fill-outline-color', '#35191d');
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
      const existingFilter = 'filter' in layer ? layer.filter : undefined;
      const parkingAisleFilter = ['!=', ['get', 'class'], 'parking_aisle'];
      const serviceRoadFilter = ['!=', ['get', 'class'], 'service'];
      const explicitAccess = ['any', ['match', ['get', 'class'], ['cycleway'], true, false], ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false], ['match', ['get', 'foot'], ['yes', 'designated', 'permissive'], true, false]];
      map.setFilter(layer.id, ['all', ...(existingFilter ? [existingFilter] : []), parkingAisleFilter, serviceRoadFilter, ...(isPath ? [explicitAccess] : [])] as any);
      const isContextRoad = isHighway;
      map.setPaintProperty(layer.id, 'line-color', isContextRoad ? '#46504d' : isCycleway ? ['match', ['get', 'surface'], UNPAVED_SURFACES, '#d59c67', '#28b6ff'] : surfaceColor('#55615c', '#72563d'));
      map.setPaintProperty(layer.id, 'line-opacity', isPedestrianFootpath && !showDiscovered ? 0 : isContextRoad ? 0.68 : isPath ? 0.52 : 0.46);
      map.setPaintProperty(layer.id, 'line-width', isMajor ? ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 5.5, 18, 10] : isPath ? ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2, 19, 3] : ['interpolate', ['linear'], ['zoom'], 10, 0.7, 15, 2.8, 18, 6]);
      if (isPedestrianFootpath) map.setPaintProperty(layer.id, 'line-dasharray', [1, 2.5]);
      else if (isCycleway || isGravelPath || isContextRoad) map.setPaintProperty(layer.id, 'line-dasharray', null);
    }
  }
  if (map.getSource('openmaptiles') && !map.getLayer('roam-bikeable-paths')) {
    map.addLayer({
      id: 'roam-bikeable-paths',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!=', ['get', 'class'], 'parking_aisle'], ['!=', ['get', 'class'], 'service'], ['match', ['get', 'class'], PATH_CLASSES, true, false], ['any', ['match', ['get', 'class'], ['cycleway'], true, false], ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false], ['match', ['get', 'foot'], ['yes', 'designated', 'permissive'], true, false]]] as any,
      paint: {
        'line-color': ['case', ['==', ['get', 'class'], 'cycleway'], ['match', ['get', 'surface'], UNPAVED_SURFACES, '#d59c67', '#229be0'], surfaceColor('#55615c', '#72563d')],
        'line-opacity': 0.52,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.5, 19, 4],
      },
    });
  }
  if (map.getSource('openmaptiles') && !map.getLayer('roam-discovered-network')) {
    map.addLayer({
      id: 'roam-discovered-network',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['all', ['!=', ['get', 'class'], 'parking_aisle'], ['!=', ['get', 'class'], 'service'], ['any', ['all', ['match', ['get', 'class'], PATH_CLASSES, true, false], ['any', ['match', ['get', 'class'], ['cycleway'], true, false], ['match', ['get', 'bicycle'], ['yes', 'designated', 'permissive'], true, false], ['match', ['get', 'foot'], ['yes', 'designated', 'permissive'], true, false]]], ['all', ['match', ['get', 'class'], LOCAL_STREET_CLASSES, true, false], ['!=', ['get', 'bicycle'], 'no']]]] as any,
      paint: {
        'line-color': ['case', ['==', ['get', 'class'], 'cycleway'], ['match', ['get', 'surface'], UNPAVED_SURFACES, '#d59c67', '#28b6ff'], ['match', ['get', 'surface'], UNPAVED_SURFACES, '#d59c67', '#f0eee7']],
        'line-opacity': 0.98,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2.5, 19, 4],
      },
      layout: { visibility: showDiscovered ? 'visible' : 'none' },
    } as any);
  }
  if (map.getSource('openmaptiles')) {
    if (!map.getLayer('roam-restricted-landuse')) {
      map.addLayer({
        id: 'roam-restricted-landuse',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['match', ['get', 'class'], ['military'], true, false] as any,
        paint: { 'fill-color': '#35191d', 'fill-opacity': 0.94 },
      } as any);
    }
    if (!map.getLayer('roam-restricted-aeroway')) {
      map.addLayer({
        id: 'roam-restricted-aeroway',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'aeroway',
        filter: ['match', ['get', 'class'], ['aerodrome', 'airport'], true, false] as any,
        paint: { 'fill-color': '#35191d', 'fill-opacity': 0.94 },
      } as any);
    }
  }
  if (map.getLayer('roam-discovered-network')) {
    map.setLayoutProperty('roam-discovered-network', 'visibility', showDiscovered ? 'visible' : 'none');
  }
}

function formatCoordinates(lng: number, lat: number) {
  const latitude = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
  const longitude = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
  return `${latitude} / ${longitude}`;
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

function MapCanvas({ mapRef, showDiscovered, onLocationChange }: { mapRef: React.MutableRefObject<Map | null>; showDiscovered: boolean; onLocationChange: (lng: number, lat: number, locality?: { city?: string; region?: string }) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: [18.0649, 59.3326], zoom: 14, pitch: 42, bearing: -12, attributionControl: false });
    mapRef.current = map;
    map.on('load', () => {
      styleRoamMap(map, showDiscovered);
      const center = map.getCenter();
      onLocationChange(center.lng, center.lat, findMapLocality(map));
      setMapReady(true);
    });
    map.on('moveend', () => {
      const center = map.getCenter();
      onLocationChange(center.lng, center.lat, findMapLocality(map));
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [mapRef]);
  useEffect(() => {
    if (mapReady && mapRef.current) styleRoamMap(mapRef.current, showDiscovered);
  }, [mapReady, mapRef, showDiscovered]);
  return <div className="map-canvas"><div ref={containerRef} className="maplibre-container" />
    {!mapReady && <div className="map-loading">LOADING ROAD DATA…</div>}
  </div>;
}

function MapView() {
  const [showDiscovered, setShowDiscovered] = useState(true);
  const [location, setLocation] = useState({ city: 'STOCKHOLM', region: 'SÖDERMALM', coordinates: formatCoordinates(18.0649, 59.3326), lng: 18.0649, lat: 59.3326 });
  const mapRef = useRef<Map | null>(null);
  const handleLocationChange = (lng: number, lat: number, locality?: { city?: string; region?: string }) => setLocation((current) => ({ ...current, lng, lat, coordinates: formatCoordinates(lng, lat), city: locality?.city?.toUpperCase() || current.city, region: locality?.region?.toUpperCase() || current.region }));
  return <section className="map-view"><MapCanvas mapRef={mapRef} showDiscovered={showDiscovered} onLocationChange={handleLocationChange} />
    <header className="map-header"><div className="map-header-actions"><button className="debug-toggle" type="button" onClick={() => setShowDiscovered(!showDiscovered)}>DEBUG / {showDiscovered ? 'DISCOVERED' : 'UNDISCOVERED'}</button></div></header>
    <div className="map-topline"><div><span>{location.city} / {location.region}</span><small>{location.coordinates}</small></div><span>42.8% REVEALED</span></div>
    <div className="map-controls" aria-label="Map controls"><button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button><button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button><button type="button" aria-label="Center on location" onClick={() => mapRef.current?.flyTo({ center: [18.0649, 59.3326], zoom: 14 })}>◎</button></div>
  </section>;
}

function PlaceholderView({ title, eyebrow, copy }: { title: string; eyebrow: string; copy: string }) { return <section className="placeholder-view"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p><div className="empty-state">MODULE READY<br /><span>Next build slice</span></div></section>; }

function App() {
  const [view, setView] = useState<View>('map');
  return <main className="app-shell"><div className="app-content">{view === 'map' && <MapView />}{view === 'sessions' && <PlaceholderView eyebrow="ROAM / SESSIONS" title="Sessions" copy="A record of every route you take. Session summaries will live here." />}{view === 'progress' && <PlaceholderView eyebrow="ROAM / PROGRESS" title="Progress" copy="See how much of your neighborhoods, city, and region you have uncovered." />}</div><nav className="bottom-nav" aria-label="Primary navigation">{([['map', '◈', 'MAP'], ['sessions', '⌁', 'SESSIONS'], ['progress', '▦', 'PROGRESS']] as const).map(([key, icon, label]) => <button key={key} className={view === key ? 'nav-item nav-item--active' : 'nav-item'} onClick={() => setView(key)} type="button"><span className="nav-icon">{icon}</span><span>{label}</span></button>)}</nav></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
