import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { type Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';

type View = 'map' | 'sessions' | 'progress';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function styleRoamMap(map: Map) {
  const layers = map.getStyle().layers ?? [];
  map.setPaintProperty('background', 'background-color', '#0a0b0c');
  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    const sourceLayer = 'source-layer' in layer && typeof layer['source-layer'] === 'string' ? layer['source-layer'].toLowerCase() : '';
    const isRoad = id.includes('transportation') || sourceLayer === 'transportation';
    const isWater = id.includes('water') || sourceLayer === 'water';
    const isPark = /park|wood|forest|grass|meadow|cemetery|recreation|garden|landcover/.test(id) || /landcover|landuse/.test(sourceLayer);
    if (layer.type === 'symbol' || id.includes('building') || id.includes('boundary') || id === 'park_outline' || id === 'landcover_wetland' || id === 'road_area_pattern') {
      map.setLayoutProperty(layer.id, 'visibility', 'none');
    }
    if (layer.type === 'fill' && isWater) {
      map.setPaintProperty(layer.id, 'fill-color', '#142a3a');
      map.setPaintProperty(layer.id, 'fill-opacity', 0.92);
    }
    if (layer.type === 'fill' && isPark) {
      map.setPaintProperty(layer.id, 'fill-color', '#13251f');
      map.setPaintProperty(layer.id, 'fill-opacity', 0.86);
      if (id === 'park') map.setPaintProperty(layer.id, 'fill-outline-color', '#13251f');
    }
    if (layer.type === 'line' && isWater) {
      map.setPaintProperty(layer.id, 'line-color', '#24465a');
      map.setPaintProperty(layer.id, 'line-opacity', 0.8);
    }
    if (isRoad && layer.type === 'line') {
      const isPath = /path|track|footway|cycleway|bridleway|pedestrian/.test(id);
      const isMajor = /motorway|trunk|primary/.test(id);
      const isGravel = /track|path|footway|bridleway/.test(id);
      map.setPaintProperty(layer.id, 'line-color', isGravel ? '#d59c67' : '#e9e7df');
      map.setPaintProperty(layer.id, 'line-opacity', isPath ? 0.82 : 0.96);
      map.setPaintProperty(layer.id, 'line-width', isMajor ? ['interpolate', ['linear'], ['zoom'], 10, 1.2, 15, 5.5, 18, 10] : isPath ? ['interpolate', ['linear'], ['zoom'], 12, 0.8, 16, 2, 19, 3] : ['interpolate', ['linear'], ['zoom'], 10, 0.7, 15, 2.8, 18, 6]);
      if (isPath) map.setPaintProperty(layer.id, 'line-dasharray', [1, 2.5]);
    }
  }
}

function MapCanvas({ mapRef }: { mapRef: React.MutableRefObject<Map | null> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: [18.0649, 59.3326], zoom: 14, pitch: 42, bearing: -12, attributionControl: false });
    mapRef.current = map;
    map.on('load', () => { styleRoamMap(map); setMapReady(true); });
    return () => { map.remove(); mapRef.current = null; };
  }, [mapRef]);
  return <div className="map-canvas"><div ref={containerRef} className="maplibre-container" />
    <div className="map-coordinates"><span>59°20' N</span><span>18°04' E</span></div><div className="map-scale">100 M</div>
    {!mapReady && <div className="map-loading">LOADING ROAD DATA…</div>}
  </div>;
}

function MapView() {
  const [tracking, setTracking] = useState(false);
  const mapRef = useRef<Map | null>(null);
  return <section className="map-view"><MapCanvas mapRef={mapRef} />
    <header className="map-header"><div className="wordmark">ROAM<span>/01</span></div><div className="header-status"><i className={tracking ? 'status-dot status-dot--live' : 'status-dot'} />{tracking ? 'TRACKING' : 'READY'}</div></header>
    <div className="map-topline"><span>STOCKHOLM / SÖDERMALM</span><span>42.8% REVEALED</span></div>
    <div className="map-controls" aria-label="Map controls"><button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button><button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button><button type="button" aria-label="Center on location" onClick={() => mapRef.current?.flyTo({ center: [18.0649, 59.3326], zoom: 14 })}>◎</button></div>
    <div className="map-legend"><span><b className="legend-line legend-line--paved" />PAVED</span><span><b className="legend-line legend-line--gravel" />GRAVEL / PATH</span><span><b className="legend-line legend-line--hidden" />UNEXPLORED</span></div>
    <div className="session-dock"><div><span className="dock-label">CURRENT SESSION</span><strong>{tracking ? '00:00:18' : 'NO ACTIVE SESSION'}</strong></div><button className={`track-button ${tracking ? 'track-button--active' : ''}`} type="button" onClick={() => setTracking(!tracking)}><span className="track-button__icon">{tracking ? '■' : '▶'}</span>{tracking ? 'END SESSION' : 'START ROAMING'}</button></div>
  </section>;
}

function PlaceholderView({ title, eyebrow, copy }: { title: string; eyebrow: string; copy: string }) { return <section className="placeholder-view"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p><div className="empty-state">MODULE READY<br /><span>Next build slice</span></div></section>; }

function App() {
  const [view, setView] = useState<View>('map');
  return <main className="app-shell"><div className="app-content">{view === 'map' && <MapView />}{view === 'sessions' && <PlaceholderView eyebrow="ROAM / SESSIONS" title="Sessions" copy="A record of every route you take. Session summaries will live here." />}{view === 'progress' && <PlaceholderView eyebrow="ROAM / PROGRESS" title="Progress" copy="See how much of your neighborhoods, city, and region you have uncovered." />}</div><nav className="bottom-nav" aria-label="Primary navigation">{([['map', '◈', 'MAP'], ['sessions', '⌁', 'SESSIONS'], ['progress', '▦', 'PROGRESS']] as const).map(([key, icon, label]) => <button key={key} className={view === key ? 'nav-item nav-item--active' : 'nav-item'} onClick={() => setView(key)} type="button"><span className="nav-icon">{icon}</span><span>{label}</span></button>)}</nav></main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
