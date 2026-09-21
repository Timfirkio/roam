import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map } from 'maplibre-gl';
import { bbox } from '@turf/turf';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { areaApiBase, calculateArea, loadArea, lookupAreas, searchLocations, type LocationSearchResult } from './area-client';
import { exploredAreaTotals } from './area-geometry';
import type { AreaRecord, AreaTotals } from './area-types';
import type { DiscoveredSegment } from './discovery';
import { installNetworkSource, NETWORK_SOURCE } from './network-source';
import { NETWORK_MIN_ZOOM } from './network-tiles';
import { applyRoamBaseStyle, ROAM_MAP_STYLE } from './roam-map-style';
import { Button } from './components/ui/button';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from './components/ui/item';
import { Spinner } from './components/ui/spinner';

const MAP_STYLE = ROAM_MAP_STYLE;
const AREA_SOURCE = 'roam-progress-areas';
const AREA_FILL = 'roam-progress-areas-fill';
const AREA_LINE = 'roam-progress-areas-line';
const AREA_TILE_SOURCE = 'roam-progress-area-tiles';
const AREA_TILE_LINE = 'roam-progress-area-tile-lines';
const DISCOVERED_SOURCE = 'roam-progress-discovered-network';
const DISCOVERED_LAYER = 'roam-progress-discovered-network-line';
const distance = (meters: number) => `${(meters / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not load area coverage. Try again.';

export function AreaCoverageCard({ record, discoveries, onUpdate }: { record: AreaRecord; discoveries: DiscoveredSegment[]; onUpdate: (record: AreaRecord) => void }) {
  const { area, job } = record;
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const explored = useMemo(() => area.geometry ? exploredAreaTotals(discoveries, area.geometry) : null, [discoveries, area.geometry]);
  const ready = job?.status === 'ready' && job.totals;
  const percentage = ready && explored && ready.lengthMeters > 0 ? explored.lengthMeters / ready.lengthMeters * 100 : null;
  const inconsistent = percentage !== null && percentage > 100.1;
  const pending = job?.status === 'queued' || job?.status === 'running';
  const segmentWidth = (type: keyof AreaTotals['byRoadType']) => ready && explored
    ? Math.min(100, explored.byRoadType[type] / ready.lengthMeters * 100)
    : 0;
  async function calculate() {
    setRequesting(true); setError(null);
    try { onUpdate(await calculateArea(area.id)); } catch (cause) { setError(message(cause)); }
    finally { setRequesting(false); }
  }
  return <Item variant="outline" className="area-progress-card">
    <ItemContent className="district-progress-content">
      <div className="district-progress-top"><div className="district-progress-title">{area.name}</div><div className="district-progress-percent">{percentage !== null && !inconsistent ? `${Math.min(100, percentage).toFixed(1)}%` : '—'}</div></div>
      <ItemDescription className="district-progress-description">{explored ? `${distance(explored.lengthMeters)} / ` : ''}{ready ? distance(ready.lengthMeters) : 'Coverage not calculated'}</ItemDescription>
      <div className="progress-bar" aria-label={percentage !== null ? `${area.name}: ${Math.min(100, percentage).toFixed(1)} percent explored` : `${area.name}: coverage not calculated`}><i className="progress-bar__discovered"><em className="progress-bar__paved-roads" style={{ width: `${segmentWidth('paved-road')}%` }} /><em className="progress-bar__paved-cycleways" style={{ width: `${segmentWidth('cycleway')}%` }} /><em className="progress-bar__unpaved" style={{ width: `${segmentWidth('unpaved-path')}%` }} /></i></div>
      <div role="status" className="area-progress-status">{pending && <span className="inline-flex items-center gap-2"><Spinner />{job.status === 'queued' ? 'Queued' : `Calculating · ${job.completedTiles} of ${job.totalTiles} tiles`}</span>}{job?.status === 'failed' && <span>{job.error ?? 'Calculation failed. Retry to resume.'}</span>}{ready && ready.lengthMeters === 0 && 'No eligible roads in this map snapshot.'}{inconsistent && 'The saved discoveries and current map differ. Coverage needs reconciliation.'}{error && <span>{error}</span>}</div>
      {!ready && <ItemActions className="area-progress-actions"><Button variant="secondary" size="small" disabled={pending || requesting} onClick={() => void calculate()}>{requesting ? <Spinner /> : null}{job?.status === 'failed' ? 'Retry calculation' : 'Calculate coverage'}</Button></ItemActions>}
    </ItemContent>
  </Item>;
}

function preferredArea(records: AreaRecord[], zoom: number) {
  if (!records.length) return null;
  const target = zoom >= 13 ? 10 : zoom >= 10 ? 8 : zoom >= 7 ? 5 : 2;
  return [...records].sort((a, b) => Math.abs(a.area.adminLevel - target) - Math.abs(b.area.adminLevel - target) || b.area.adminLevel - a.area.adminLevel)[0];
}

function ProgressMap({ centre, records, discoveries, selected, onMapMove, onSelect }: { centre: [number, number]; records: AreaRecord[]; discoveries: DiscoveredSegment[]; selected: AreaRecord | null; onMapMove: (lng: number, lat: number, zoom: number) => void; onSelect: (record: AreaRecord) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const recordsRef = useRef(records); recordsRef.current = records;
  const onMapMoveRef = useRef(onMapMove); onMapMoveRef.current = onMapMove;
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: centre, zoom: 12, pitch: 0, bearing: 0, attributionControl: false });
    mapRef.current = map;
    let removeNetworkProtocol = () => {};
    map.on('load', () => {
      removeNetworkProtocol = installNetworkSource(map);
      applyRoamBaseStyle(map);
      // The Map and Progress tabs share the same OSM treatment. At cycling
      // zooms, replace the generalized bikeable paths with full z14 geometry.
      const overview = map.getStyle().layers?.find((layer: any) => layer.id === 'roam-bikeable-paths');
      if (overview?.type === 'line' && map.getSource(NETWORK_SOURCE) && !map.getLayer('roam-bikeable-paths-detail')) {
        map.addLayer({ ...overview, id: 'roam-bikeable-paths-detail', source: NETWORK_SOURCE, minzoom: NETWORK_MIN_ZOOM }, 'roam-bikeable-paths');
        map.setLayerZoomRange('roam-bikeable-paths', 6, NETWORK_MIN_ZOOM);
      }
      map.addSource(DISCOVERED_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: DISCOVERED_LAYER, type: 'line', source: DISCOVERED_SOURCE, minzoom: 6, maxzoom: 24,
        paint: { 'line-color': ['match', ['get', 'roadType'], 'cycleway', '#2bb8b0', 'unpaved-path', '#d59c67', 'footpath', '#2bb8b0', '#f0eee7'], 'line-opacity': 1, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 1.2, 15, 1.8, 18, 3] },
      } as any);
      map.addSource(AREA_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      if (import.meta.env.VITE_AREA_CATALOG !== 'false') {
        map.addSource(AREA_TILE_SOURCE, { type: 'vector', tiles: [`${areaApiBase}/tiles/{z}/{x}/{y}.mvt`], minzoom: 0, maxzoom: 22 });
        map.addLayer({ id: AREA_TILE_LINE, type: 'line', source: AREA_TILE_SOURCE, 'source-layer': 'boundaries', paint: { 'line-color': '#5fbbb4', 'line-opacity': 0.86, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.7, 12, 1.2, 18, 2] } } as any);
      }
      map.addLayer({ id: AREA_FILL, type: 'fill', source: AREA_SOURCE, paint: { 'fill-color': '#2bb8b0', 'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.16, 0.06] } });
      map.addLayer({ id: AREA_LINE, type: 'line', source: AREA_SOURCE, paint: { 'line-color': ['case', ['boolean', ['get', 'selected'], false], '#f0eee7', '#5fbbb4'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, ['case', ['boolean', ['get', 'selected'], false], 2.2, 1.25], 13, ['case', ['boolean', ['get', 'selected'], false], 3.2, 1.8], 18, ['case', ['boolean', ['get', 'selected'], false], 4, 2.4]], 'line-opacity': 1 } });
      map.on('click', AREA_FILL, event => { const id = String(event.features?.[0]?.properties?.id ?? ''); const record = recordsRef.current.find(item => item.area.id === id); if (record) onSelectRef.current(record); });
      map.on('mouseenter', AREA_FILL, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', AREA_FILL, () => { map.getCanvas().style.cursor = ''; });
      let timer: ReturnType<typeof setTimeout> | undefined;
      map.on('moveend', () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { const center = map.getCenter(); onMapMoveRef.current(center.lng, center.lat, map.getZoom()); }, 250); });
      setReady(true);
    });
    return () => { map.remove(); removeNetworkProtocol(); mapRef.current = null; };
  }, []);
  useEffect(() => { const map = mapRef.current; if (map && !map.isMoving()) map.easeTo({ center: centre, duration: 550 }); }, [centre[0], centre[1]]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getSource(AREA_SOURCE)) return;
    const data = { type: 'FeatureCollection' as const, features: records.filter(record => record.area.geometry).map(record => ({ type: 'Feature' as const, properties: { id: record.area.id, selected: record.area.id === selected?.area.id }, geometry: record.area.geometry! })) };
    (map.getSource(AREA_SOURCE) as maplibregl.GeoJSONSource).setData(data);
  }, [records, ready, selected?.area.id]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getSource(DISCOVERED_SOURCE)) return;
    (map.getSource(DISCOVERED_SOURCE) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: discoveries.map(segment => ({ type: 'Feature', properties: { roadType: segment.roadType }, geometry: segment.geometry })) } as any);
  }, [discoveries, ready]);
  useEffect(() => { const map = mapRef.current; if (!map || !selected?.area.geometry) return; const [west, south, east, north] = bbox(selected.area.geometry as any); map.fitBounds([[west, south], [east, north]], { padding: { top: 116, right: 36, bottom: 244, left: 36 }, maxZoom: 14, duration: 600 }); }, [selected?.area.id, selected?.area.geometry]);
  return <div className="progress-map-canvas"><div ref={containerRef} className="maplibre-container maplibre-container--ready" aria-label="Area progress map" /></div>;
}

function LocationSearch({ onSelect }: { onSelect: (result: LocationSearchResult) => void }) {
  const [query, setQuery] = useState(''); const [results, setResults] = useState<LocationSearchResult[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { const term = query.trim(); if (term.length < 2) { setResults([]); setError(null); return; } const controller = new AbortController(); const timer = setTimeout(() => { setLoading(true); setError(null); void searchLocations(term, controller.signal).then(({ results: next }) => setResults(next)).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 350); return () => { controller.abort(); clearTimeout(timer); }; }, [query]);
  return <div className="progress-map-search"><label className="sr-only" htmlFor="area-location-search">Search for a location</label><div className="progress-map-search-input"><MagnifyingGlass aria-hidden="true" /><input id="area-location-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search places, regions, or addresses" autoComplete="off" />{loading ? <Spinner /> : query && <button type="button" aria-label="Clear location search" onClick={() => setQuery('')}><X /></button>}</div>{(results.length > 0 || error) && <div className="progress-map-search-results" role="listbox" aria-label="Location results">{error && <p role="alert">{error}</p>}{results.map(result => <button type="button" key={result.id} role="option" onClick={() => { onSelect(result); setQuery(''); setResults([]); }}><strong>{result.name.split(',').slice(0, 2).join(',')}</strong><small>{result.type}</small></button>)}</div>}</div>;
}

export function AreaProgressView({ location, discoveries }: { location: { lng: number; lat: number }; discoveries: DiscoveredSegment[] }) {
  const [centre, setCentre] = useState<[number, number]>([location.lng, location.lat]); const [zoom, setZoom] = useState(12); const [records, setRecords] = useState<AreaRecord[]>([]); const [selected, setSelected] = useState<AreaRecord | null>(null); const [error, setError] = useState<string | null>(null); const lookupGeneration = useRef(0); const recordsRef = useRef(records); recordsRef.current = records;
  useEffect(() => { const controller = new AbortController(); const generation = ++lookupGeneration.current; setError(null); void lookupAreas(centre[0], centre[1], controller.signal).then(async ({ areas }) => { if (generation !== lookupGeneration.current) return; const preferred = preferredArea(areas, zoom); if (!preferred) { setRecords([]); setSelected(null); return; }
    // Resolve every enclosing boundary one at a time. This keeps each outline
    // tappable and avoids a burst of requests to the OSM boundary provider.
    const loaded: AreaRecord[] = [];
    for (const record of [preferred, ...areas.filter(record => record.area.id !== preferred.area.id)]) {
      try { loaded.push(await loadArea(record.area.id, controller.signal, true)); }
      catch (cause) { if (!controller.signal.aborted && record.area.id === preferred.area.id) throw cause; }
      if (generation !== lookupGeneration.current || controller.signal.aborted) return;
    }
    setRecords(loaded);
    setSelected(current => loaded.find(record => record.area.id === current?.area.id) ?? loaded[0] ?? null);
  }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)); }); return () => controller.abort(); }, [centre[0], centre[1], zoom]);
  useEffect(() => { const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; const poll = async () => { const pending = recordsRef.current.filter(record => record.job?.status === 'queued' || record.job?.status === 'running'); if (pending.length) { try { const updates = await Promise.all(pending.map(record => loadArea(record.area.id, controller.signal, true))); if (!controller.signal.aborted) { setRecords(current => current.map(record => updates.find(update => update.area.id === record.area.id) ?? record)); setSelected(current => updates.find(update => update.area.id === current?.area.id) ?? current); } } catch {} } if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000); }; timer = setTimeout(() => void poll(), 3000); return () => { controller.abort(); clearTimeout(timer); }; }, []);
  const updateRecord = (updated: AreaRecord) => { setRecords(current => current.map(record => record.area.id === updated.area.id ? updated : record)); setSelected(current => current?.area.id === updated.area.id ? updated : current); };
  const select = (record: AreaRecord) => { setSelected(record); if (!record.area.geometry) void loadArea(record.area.id, undefined, true).then(updateRecord).catch(cause => setError(message(cause))); };
  return <section className="progress-map-view"><ProgressMap centre={centre} records={records} discoveries={discoveries} selected={selected} onMapMove={(lng, lat, nextZoom) => { setCentre([lng, lat]); setZoom(nextZoom); }} onSelect={select} /><LocationSearch onSelect={result => { setCentre([result.lng, result.lat]); setZoom(13); }} />{selected && <div className="progress-map-overlay"><AreaCoverageCard record={selected} discoveries={discoveries} onUpdate={updateRecord} /></div>}{error && <div className="progress-map-message" role="alert">{error}</div>}</section>;
}
