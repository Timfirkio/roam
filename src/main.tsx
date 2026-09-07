import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

type View = 'map' | 'sessions' | 'progress';
type LocationState = { city: string; region: string; lng: number; lat: number };

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const UNPAVED_SURFACES = ['gravel', 'fine_gravel', 'dirt', 'earth', 'ground', 'unpaved', 'mud', 'sand', 'grass', 'woodchips', 'pebblestone', 'compacted'];
const PATH_CLASSES = ['cycleway', 'path', 'pedestrian', 'footway', 'track', 'bridleway'];
const LOCAL_STREET_CLASSES = ['minor', 'tertiary', 'secondary', 'residential', 'living_street', 'unclassified'];
const DEFAULT_LOCATION: LocationState = { city: 'STOCKHOLM', region: 'SÖDERMALM', lng: 18.0649, lat: 59.3326 };

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
      if (isPath) map.setLayerZoomRange(layer.id, 7, 24);
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
      minzoom: 7,
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
      minzoom: 7,
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

function MapCanvas({ mapRef, showDiscovered, is3D, onLocationChange, onBearingChange }: { mapRef: React.MutableRefObject<Map | null>; showDiscovered: boolean; is3D: boolean; onLocationChange: (lng: number, lat: number, locality?: { city?: string; region?: string }) => void; onBearingChange: (bearing: number) => void }) {
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
      onBearingChange(map.getBearing());
      setMapReady(true);
    });
    map.on('rotate', () => onBearingChange(map.getBearing()));
    map.on('moveend', () => {
      const center = map.getCenter();
      onLocationChange(center.lng, center.lat, findMapLocality(map));
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [mapRef]);
  useEffect(() => {
    if (mapReady && mapRef.current) styleRoamMap(mapRef.current, showDiscovered);
  }, [mapReady, mapRef, showDiscovered]);
  useEffect(() => {
    if (mapReady && mapRef.current) mapRef.current.easeTo({ pitch: is3D ? 42 : 0, bearing: is3D ? -12 : 0, duration: 450 });
  }, [mapReady, mapRef, is3D]);
  return <div className="map-canvas"><div ref={containerRef} className="maplibre-container" />
    {!mapReady && <div className="map-loading">LOADING ROAD DATA…</div>}
  </div>;
}

function MapView({ onOpenProgress }: { onOpenProgress: (location: LocationState) => void }) {
  const [showDiscovered, setShowDiscovered] = useState(true);
  const [is3D, setIs3D] = useState(true);
  const [bearing, setBearing] = useState(-12);
  const [debugOpen, setDebugOpen] = useState(false);
  const [location, setLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const mapRef = useRef<Map | null>(null);
  const handleLocationChange = (lng: number, lat: number, locality?: { city?: string; region?: string }) => setLocation((current) => ({ ...current, lng, lat, city: locality?.city?.toUpperCase() || current.city, region: locality?.region?.toUpperCase() || current.region }));
  const summaryWidth = Math.max(190, Math.min(320, 70 + Math.max(location.city.length + location.region.length, 18) * 6));
  return <section className="map-view"><MapCanvas mapRef={mapRef} showDiscovered={showDiscovered} is3D={is3D} onLocationChange={handleLocationChange} onBearingChange={setBearing} />
    <header className="map-header"><span className="map-header-spacer" aria-hidden="true" /><button className="location-summary map-ui-surface" style={{ width: `${summaryWidth}px` }} type="button" onClick={() => onOpenProgress(location)}><strong>{location.city} / {location.region}</strong><span>42.8% DISCOVERED</span><i className="summary-progress"><b style={{ width: '42.8%' }} /></i></button><span className="map-header-spacer" aria-hidden="true" /></header>
    <div className="map-compass"><button className="map-ui-surface" type="button" aria-label="Reset compass north" onClick={() => mapRef.current?.easeTo({ bearing: 0, duration: 450 })}><span>N</span><b style={{ transform: `rotate(${-bearing}deg)` }}>▲</b></button></div><div className="map-controls" aria-label="Map controls"><button className="map-ui-surface map-mode-toggle" type="button" aria-label={`Switch to ${is3D ? '2D' : '3D'} view`} onClick={() => setIs3D(!is3D)}>{is3D ? '3D' : '2D'}</button><button className="map-ui-surface" type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button><button className="map-ui-surface" type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button><button className="map-ui-surface" type="button" aria-label="Center on location" onClick={() => mapRef.current?.flyTo({ center: [18.0649, 59.3326], zoom: 14 })}>◎</button></div>
    <div className="map-debug"><button className="map-ui-surface debug-icon" type="button" aria-label="Open debug settings" aria-expanded={debugOpen} onClick={() => setDebugOpen(!debugOpen)}>⌘</button>{debugOpen && <div className="debug-menu map-ui-surface"><p>DEBUG SETTINGS</p><button type="button" onClick={() => setShowDiscovered(!showDiscovered)}><span>DISCOVERED LAYER</span><b>{showDiscovered ? 'ON' : 'OFF'}</b></button><div><span>ROAD FILTER</span><b>BIKEABLE</b></div><div><span>RESTRICTED AREAS</span><b>MASKED</b></div></div>}</div>
  </section>;
}

function PlaceholderView({ title, eyebrow, copy }: { title: string; eyebrow: string; copy: string }) { return <section className="placeholder-view"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p><div className="empty-state">MODULE READY<br /><span>Next build slice</span></div></section>; }

function ProgressView({ location }: { location: LocationState }) {
  const areas = [
    { name: location.region, city: location.city, percent: '42.8%', types: 'PAVED 61% · GRAVEL 24% · FOOT 15%' },
    { name: 'Södermalm', city: 'Stockholm', percent: '42.8%', types: 'PAVED 61% · GRAVEL 24% · FOOT 15%' },
    { name: 'Liljeholmen', city: 'Stockholm', percent: '31.4%', types: 'PAVED 54% · GRAVEL 31% · FOOT 15%' },
    { name: 'Kungsholmen', city: 'Stockholm', percent: '27.9%', types: 'PAVED 68% · GRAVEL 18% · FOOT 14%' },
    { name: 'Aspudden', city: 'Stockholm', percent: '19.6%', types: 'PAVED 49% · GRAVEL 38% · FOOT 13%' },
  ];
  return <section className="progress-view"><div className="progress-header"><p className="eyebrow">ROAM / PROGRESS</p><h1>Progress</h1><p>Explore the network by neighborhood. Every percentage is a measure of paths uncovered.</p></div><div className="progress-current"><span className="progress-label">CURRENT AREA</span><strong>{location.city} / {location.region}</strong></div><div className="progress-areas">{areas.map((area, index) => <article className={index === 0 ? 'progress-area progress-area--current' : 'progress-area'} key={`${area.city}-${area.name}`}><div className="progress-area-top"><div><strong>{area.name}</strong><span>{area.city}</span></div><b>{area.percent}</b></div><div className="progress-bar"><i style={{ width: area.percent }} /></div><small>{area.types}</small></article>)}</div></section>;
}

function App() {
  const [view, setView] = useState<View>('map');
  const [progressLocation, setProgressLocation] = useState<LocationState>(DEFAULT_LOCATION);
  const openProgress = (location: LocationState) => { setProgressLocation(location); setView('progress'); };
  return <main className="app-shell"><div className="app-content">{view === 'map' && <MapView onOpenProgress={openProgress} />}{view === 'sessions' && <PlaceholderView eyebrow="ROAM / SESSIONS" title="Sessions" copy="A record of every route you take. Session summaries will live here." />}{view === 'progress' && <ProgressView location={progressLocation} />}</div><nav className="bottom-nav" aria-label="Primary navigation">{([['map', '◈', 'MAP'], ['sessions', '⌁', 'SESSIONS'], ['progress', '▦', 'PROGRESS']] as const).map(([key, icon, label]) => <button key={key} className={view === key ? 'nav-item nav-item--active' : 'nav-item'} onClick={() => setView(key)} type="button"><span className="nav-icon">{icon}</span><span>{label}</span></button>)}</nav></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
